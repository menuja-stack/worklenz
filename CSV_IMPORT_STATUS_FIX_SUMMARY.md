# CSV Import "Doing" Status Fix - Complete Changes

## Problem
The "Doing" status (and other project-specific statuses) were not being saved correctly during CSV import because the SQL queries were missing the `project_id` filter when looking up statuses from the `task_statuses` table.

## Root Cause
The `task_statuses` table has a `project_id` column, but the queries were not filtering by it. This caused:
1. Wrong statuses to be matched (from other projects)
2. Default status to be used instead of the mapped status
3. "Doing" status not showing after import

## Files Changed

### 1. Backend SQL Function: `worklenz-backend/src/db/functions/create_tasks_from_csv_import.sql`

**Changes:**
- Line 69-76: Added `ts.project_id = _project_id` filter to default status query
- Line 165: Added `AND ts.project_id = _project_id` to status lookup query
- Line 174: Updated error message to say "not found in project"

### 2. Backend Controller: `worklenz-backend/src/controllers/task-csv-import-controller.ts`

**Changes:**
- Line 262-263: Updated status query to include `project_id` filter
  ```typescript
  // OLD:
  SELECT LOWER(name) AS name, id FROM task_statuses WHERE LOWER(name) = ANY($1)
  
  // NEW:
  SELECT LOWER(name) AS name, id FROM task_statuses WHERE project_id = $1 AND LOWER(name) = ANY($2)
  ```

### 3. Backend SQL Function: `worklenz-backend/src/db/functions/get_csv_import_template_fields.sql`

**Changes:**
- Line 16: Changed from `project_statuses` to `task_statuses` table
- Line 47-58: Changed all `ps` aliases to `ts` (task_statuses)
- Line 58: Added `WHERE ts.project_id = _project_id` filter

### 4. Frontend Component: `worklenz-frontend/src/components/task-templates/import-csv-template.tsx`

**Changes:**
- Line 102: Added `sort_order: number` to ProjectTemplate interface
- Line 283-314: Made `worklenzPriorities` and `worklenzStatuses` dynamic using `useMemo`
  - Now loads actual project statuses from template
  - Falls back to hardcoded values if template not available
  - Includes "Doing" status in fallback
  - Added `is_done` property to status objects

## Key Fix
The critical fix was adding `ts.project_id = _project_id` to the WHERE clause:

```sql
-- BEFORE (WRONG):
SELECT ts.id
INTO _status_id
FROM task_statuses ts
WHERE lower(ts.name) = lower(_status_name)
LIMIT 1;

-- AFTER (CORRECT):
SELECT ts.id
INTO _status_id
FROM task_statuses ts
WHERE lower(ts.name) = lower(_status_name) AND ts.project_id = _project_id
LIMIT 1;
```

## How to Apply

### Step 1: Reload SQL Functions
```bash
cd /home/ceydigital/Documents/worklenz/worklenz

# Update both SQL functions
docker exec -i worklenz_db psql -U postgres -d worklenz_db < worklenz-backend/src/db/functions/create_tasks_from_csv_import.sql
docker exec -i worklenz_db psql -U postgres -d worklenz_db < worklenz-backend/src/db/functions/get_csv_import_template_fields.sql
```

### Step 2: Restart Backend
```bash
docker-compose restart backend
```

### Step 3: Test
1. Import a CSV with status column containing "Doing", "To Do", "Done"
2. Verify tasks show the correct status after import
3. Check that statuses match your project's configured statuses

## What This Fixes
✅ "Doing" status now shows correctly after CSV import
✅ All project-specific statuses work (To Do, Doing, Done, custom statuses)
✅ Status matching is project-aware - only matches statuses from current project
✅ Priorities also use project-specific values if available
✅ Frontend displays actual project statuses in the mapping UI

## Testing Checklist
- [ ] Import CSV with "Doing" status → Should show "Doing" after import
- [ ] Import CSV with "To Do" status → Should show "To Do" after import
- [ ] Import CSV with "Done" status → Should show "Done" after import
- [ ] Import CSV with custom status names → Should match to project statuses
- [ ] Verify no warnings about "status not found" in import results
- [ ] Check that tasks have correct status_id in database

## Database Schema Reference
The `task_statuses` table structure:
```sql
CREATE TABLE task_statuses (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id),
    team_id UUID NOT NULL,
    category_id UUID REFERENCES sys_task_status_categories(id),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Note: This is project-specific, not global. Each project has its own statuses.
