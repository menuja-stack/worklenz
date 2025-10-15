import { IWorkLenzRequest } from "../interfaces/worklenz-request";
import { IWorkLenzResponse } from "../interfaces/worklenz-response";

import db from "../config/db";
import { ServerResponse } from "../models/server-response";
import WorklenzControllerBase from "./worklenz-controller-base";
import HandleExceptions from "../decorators/handle-exceptions";

// Frontend-aligned types
interface IProjectTask {
  id: string;
  name: string;
  description?: string;
  priority?: string;
  assignee?: string;
  dueDate?: string;
  status?: string;
}

interface UserMapping {
  csvUser: string;
  worklenzUser: string;
  action: 'create' | 'map' | 'skip';
  email?: string;
}

interface FieldMapping {
  csvField: string;
  worklenzField: string;
  required: boolean;
  mapped: boolean;
  fieldValue?: string;
}

export default class TaskcsvimportController extends WorklenzControllerBase {
  
  @HandleExceptions()
  public static async create(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const projectId = req.params.projectId;
    const { tasks, userMappings, fieldMappings } = req.body;

    if (!projectId) {
        return res.status(400).send(new ServerResponse(false, null, "Missing projectId"));
    }

    if (!req.user) {
      return res.status(401).send(new ServerResponse(false, null, "Unauthorized"));
    }

    const { team_id: teamId, id: userId } = req.user;

    if (!tasks || !projectId) {
      return res.status(400).send(new ServerResponse(false, null, "Missing tasks or projectId"));
    }

    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Apply frontend fieldValue overrides (e.g., priority/status choices in Map Fields)
      const effectiveTasks: IProjectTask[] = Array.isArray(tasks)
        ? (tasks as IProjectTask[]).map((t) => {
            const updated: IProjectTask = { ...t };
            if (Array.isArray(fieldMappings)) {
              const priorityMap = (fieldMappings as FieldMapping[]).find(f => f.mapped && f.worklenzField === 'priority' && (f as any).fieldValue);
              const statusMap = (fieldMappings as FieldMapping[]).find(f => f.mapped && f.worklenzField === 'status' && (f as any).fieldValue);
              if ((priorityMap as any)?.fieldValue) {
                updated.priority = (priorityMap as any).fieldValue;
              }
              if ((statusMap as any)?.fieldValue) {
                updated.status = (statusMap as any).fieldValue;
              }
            }
            return updated;
          })
        : [];

      // Step 1: Validate project exists and user has access
      const projectCheckQuery = `
        SELECT p.id, p.team_id, p.name 
        FROM projects p
        WHERE p.id = $1 AND p.team_id = $2
      `;
      const projectResult = await client.query(projectCheckQuery, [projectId, teamId]);
      
      if (projectResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).send(new ServerResponse(false, null, "Project not found or access denied"));
      }

      const project = projectResult.rows[0];

      // Step 2: Create users if needed using stored procedure (only if available)
      if (Array.isArray(userMappings) && userMappings.length > 0) {
        // Only pass actionable items with emails
        const createCandidates = (userMappings as UserMapping[])
          .filter(u => u.action === 'create' && !!u.email);

        if (createCandidates.length > 0) {
          // Check if the helper function exists in DB; if not, skip user creation silently
          const procExistsRes = await client.query(
            `SELECT EXISTS(
               SELECT 1 FROM pg_proc WHERE proname = 'create_users_from_csv_import'
             ) AS exists`
          );
          const procExists = !!procExistsRes.rows?.[0]?.exists;

          if (procExists) {
            try {
              const createUsersResult = await client.query(
                'SELECT create_users_from_csv_import($1, $2, $3)',
                [teamId, JSON.stringify(createCandidates), userId]
              );
              const userCreationResult = createUsersResult.rows[0]?.create_users_from_csv_import;
              if (userCreationResult?.errors?.length) {
                // Keep going; don't surface DB column mismatches as errors
              }
            } catch (createErr) {
              // Suppress schema-mismatch issues (e.g., users.display_name not existing)
              console.warn('User creation skipped due to DB error');
            }
          }
        }
      }

      // Step 3: Validate CSV data before import
      const validationResult = await client.query(
        'SELECT validate_csv_import_data($1, $2)',
        [projectId, JSON.stringify(effectiveTasks)]
      );

      const validation = validationResult.rows[0].validate_csv_import_data;
      
      if (!validation.is_valid) {
        await client.query('ROLLBACK');
        return res.status(400).send(new ServerResponse(false, {
          message: "CSV data validation failed",
          errors: validation.errors,
          warnings: validation.warnings
        }));
      }

      // Step 4: Import tasks using stored procedure (new proc) with graceful fallback
      try {
        // Verify the new procedure exists in the current search_path
        const procCheck = await client.query(
          `SELECT EXISTS(
             SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE p.proname = 'create_tasks_from_csv_import' AND n.nspname = 'public'
           ) AS exists`
        );

        if (!procCheck.rows?.[0]?.exists) {
          throw new Error('create_tasks_from_csv_import not available');
        }

        const importResult = await client.query(
          'SELECT create_tasks_from_csv_import($1, $2, $3)',
          [projectId, JSON.stringify(effectiveTasks), userId]
        );

        const importData: any = importResult?.rows?.[0]?.create_tasks_from_csv_import || null;
        if (!importData) {
          throw new Error('create_tasks_from_csv_import returned no data');
        }

        // Normalize response fields from procedure
        const importedCount = Number(
          importData?.body?.imported_count ?? importData?.imported_count ?? 0
        );
        const importErrors = (importData?.import_errors || importData?.errors || []) as any[];
        const warningList = (importData?.validation_warnings || importData?.warnings || []) as any[];
        const message = importData?.message || `Successfully imported ${importedCount} tasks to ${project.name}`;

        // Commit transaction
        await client.query('COMMIT');

        // Helpful debug output (server logs only)
        console.debug('CSV Import via procedure:', {
          projectId,
          importedCount,
          errorCount: Array.isArray(importErrors) ? importErrors.length : 0,
          warningCount: Array.isArray(warningList) ? warningList.length : 0
        });

        return res.status(201).send(new ServerResponse(true, {
          message,
          imported_count: importedCount,
          validation_warnings: warningList,
          import_errors: importErrors,
          project_name: project.name
        }));
      } catch (procError) {
        console.warn('Stored procedure import failed, falling back to direct insert:', procError);

        // Build email -> userId map for assignee resolution
        const candidateEmailsSet = new Set<string>();
        for (const t of tasks as IProjectTask[]) {
          if (t.assignee && t.assignee.includes('@')) {
            candidateEmailsSet.add(t.assignee.toLowerCase());
          }
        }
        if (Array.isArray(userMappings)) {
          for (const um of userMappings as UserMapping[]) {
            if (um.worklenzUser && um.worklenzUser.includes('@')) {
              candidateEmailsSet.add(um.worklenzUser.toLowerCase());
            }
            if (um.email && um.email.includes('@')) {
              candidateEmailsSet.add(um.email.toLowerCase());
            }
          }
        }

        const candidateEmails = Array.from(candidateEmailsSet);
        let emailToUserId: Record<string, string> = {};
        if (candidateEmails.length > 0) {
          const usersQuery = `
            SELECT id, LOWER(email) AS email
            FROM users
            WHERE LOWER(email) = ANY($1)
          `;
          const usersRes = await client.query(usersQuery, [candidateEmails]);
          for (const row of usersRes.rows) {
            emailToUserId[row.email] = row.id;
          }
        }

        // Build email -> team_member_id and project_member_id map for assignee resolution
        let emailToTeamMemberId: Record<string, string> = {};
        let emailToProjectMemberId: Record<string, string> = {};
        if (candidateEmails.length > 0) {
          const teamMembersQuery = `
            SELECT tm.id AS team_member_id, pm.id AS project_member_id, LOWER(u.email) AS email
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            LEFT JOIN project_members pm ON pm.team_member_id = tm.id AND pm.project_id = $1
            WHERE tm.team_id = $2 AND LOWER(u.email) = ANY($3)
          `;
          const tmr = await client.query(teamMembersQuery, [projectId, teamId, candidateEmails]);
          for (const row of tmr.rows) {
            emailToTeamMemberId[row.email] = row.team_member_id;
            if (row.project_member_id) {
              emailToProjectMemberId[row.email] = row.project_member_id;
            }
          }
        }

        // Preload priority and status ids by name
        const allPriorityNames = Array.from(new Set((effectiveTasks as IProjectTask[])
          .map(t => (t.priority || 'Medium').trim().toLowerCase())));
        const allStatusNames = Array.from(new Set((effectiveTasks as IProjectTask[])
          .map(t => (t.status || 'To Do').trim().toLowerCase())));

        const prRes = await client.query(
          `SELECT LOWER(name) AS name, id FROM task_priorities WHERE LOWER(name) = ANY($1)`,
          [allPriorityNames]
        );
        const stRes = await client.query(
          `SELECT LOWER(name) AS name, id FROM task_statuses WHERE project_id = $1 AND LOWER(name) = ANY($2)`,
          [projectId, allStatusNames]
        );
        const priorityNameToId: Record<string, string> = {};
        const statusNameToId: Record<string, string> = {};
        for (const r of prRes.rows) priorityNameToId[r.name] = r.id;
        for (const r of stRes.rows) statusNameToId[r.name] = r.id;

        // Insert tasks one-by-one to attach assignees correctly
        let insertedCount = 0;
        for (const t of effectiveTasks as IProjectTask[]) {
          if (!t.name) continue;

          const priorityId = priorityNameToId[(t.priority || 'Medium').trim().toLowerCase()] || null;
          const statusId = statusNameToId[(t.status || 'To Do').trim().toLowerCase()] || null;
          const endDate = t.dueDate && t.dueDate !== '' ? t.dueDate : null;
          const assigneeEmail = t.assignee && t.assignee.includes('@') ? t.assignee.toLowerCase() : null;
          const teamMemberId = assigneeEmail ? (emailToTeamMemberId[assigneeEmail] || null) : null;
          const projectMemberId = assigneeEmail ? (emailToProjectMemberId[assigneeEmail] || null) : null;

          // Get next available sort_order
          const sortOrderRes = await client.query(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM tasks WHERE project_id = $1`,
            [projectId]
          );
          const nextSortOrder = sortOrderRes.rows[0].next_sort_order;

          // Use CSV id if provided and valid UUID, otherwise let DB generate
          const useCustomId = t.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.id);
          
          let ins;
          if (useCustomId) {
            ins = await client.query(
              `INSERT INTO tasks (
                id,
                project_id,
                name,
                description,
                priority_id,
                status_id,
                sort_order,
                end_date,
                reporter_id,
                created_at,
                updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, NULLIF($8,'')::date, $9, NOW(), NOW()
              ) RETURNING id`,
              [
                t.id,
                projectId,
                t.name,
                t.description || null,
                priorityId,
                statusId,
                nextSortOrder,
                endDate,
                userId
              ]
            );
          } else {
            ins = await client.query(
              `INSERT INTO tasks (
                project_id,
                name,
                description,
                priority_id,
                status_id,
                sort_order,
                end_date,
                reporter_id,
                created_at,
                updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, NULLIF($7,'')::date, $8, NOW(), NOW()
              ) RETURNING id`,
              [
                projectId,
                t.name,
                t.description || null,
                priorityId,
                statusId,
                nextSortOrder,
                endDate,
                userId
              ]
            );
          }
          const newTaskId = ins.rows[0].id as string;
          insertedCount += 1;

          if (teamMemberId && projectMemberId) {
            await client.query(
              `INSERT INTO tasks_assignees (task_id, project_member_id, team_member_id, assigned_by, created_at, updated_at)
               VALUES ($1, $2, $3, $4, NOW(), NOW())`,
              [newTaskId, projectMemberId, teamMemberId, userId]
            );
          }
        }

        await client.query('COMMIT');

        return res.status(201).send(new ServerResponse(true, {
          message: `Successfully imported ${insertedCount} tasks to ${project.name}`,
          imported_count: insertedCount,
          validation_warnings: validation.warnings || [],
          import_errors: [],
          project_name: project.name
        }));
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error("CSV Import Error:", error);
      
      // Return user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return res.status(500).send(new ServerResponse(false, null, `Import failed: ${errorMessage}`));
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async getTemplateFields(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const projectId = req.params.projectId;
    try {
      if (!projectId) {
        return res.status(400).send(new ServerResponse(false, null, "Project ID is required"));
      }

      const result = await db.query(
        'SELECT get_csv_import_template_fields($1)',
        [projectId]
      );

      const body = result.rows?.[0]?.get_csv_import_template_fields;
      return res.status(200).send(new ServerResponse(true, body));
    } catch (error) {
      console.error('getTemplateFields error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).send(new ServerResponse(false, null, `Failed to load template fields: ${msg}`));
    }
  }

  @HandleExceptions()
  public static async validateData(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const projectId = req.params.projectId;
    const { tasks } = req.body;

    try {
        console.log('Validating tasks for project:', projectId); // Debug log

        if (!projectId) {
            return res.status(400).send(new ServerResponse(false, null, "Project ID is required"));
        }

        if (!tasks || !Array.isArray(tasks)) {
            return res.status(400).send(new ServerResponse(false, null, "Valid tasks array is required"));
        }

        const validationResult = await db.query(
            'SELECT validate_csv_import_data($1, $2)',
            [projectId, JSON.stringify(tasks)]
        );

        const validation = validationResult.rows[0]?.validate_csv_import_data;
        if (!validation) {
            return res.status(500).send(new ServerResponse(false, null, "Validation failed"));
        }

        return res.status(200).send(new ServerResponse(true, validation));

    } catch (error) {
        console.error("Validation error:", error);
        return res.status(500).send(new ServerResponse(false, null, 
            "Validation failed: " + (error instanceof Error ? error.message : 'Unknown error')));
    }
  }
}