-- DROP FUNCTION IF EXISTS public.create_tasks_from_csv_import(uuid, json, uuid);

CREATE OR REPLACE FUNCTION public.create_tasks_from_csv_import(_project_id uuid, _task_mappings json, _created_by uuid)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  _task_mapping           json;
  _errors                 json[] := ARRAY[]::json[];
  _created_tasks          json[] := ARRAY[]::json[];
  _warning_list           json[] := ARRAY[]::json[];

  _task_name              text;
  _description            text;
  _priority_name          text;
  _priority_id            uuid;
  _status_name            text;
  _status_id              uuid;
  _due_date               date;
  _assignee_email         text;
  _assignee_user_id       uuid;
  _team_member_id         uuid;
  _new_task_id            uuid;
  _team_id                uuid;
  _assignee_action        text;

  _default_priority_id    uuid;
  _default_status_id      uuid;

  _priorities_exist       boolean := false;
  _project_statuses_exist boolean := false;
  _team_members_exist     boolean := false;
  _tasks_assignees_exist  boolean := false;
BEGIN
  -- Check which tables exist
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'priorities' AND table_schema = 'public') INTO _priorities_exist;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'project_statuses' AND table_schema = 'public') INTO _project_statuses_exist;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'team_members' AND table_schema = 'public') INTO _team_members_exist;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'tasks_assignees' AND table_schema = 'public') INTO _tasks_assignees_exist;

  -- Validate project and get team
  SELECT p.team_id
  INTO _team_id
  FROM projects p
  WHERE p.id = _project_id;

  IF _team_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Project not found',
      'body', json_build_object('imported_count', 0, 'created_tasks', '[]'::json),
      'import_errors', json_build_array(json_build_object('error', 'Project not found')),
      'validation_warnings', '[]'::json,
      'done', true,
      'project_name', NULL
    );
  END IF;

  -- Get default priority (fallback: first active priority or any priority)
  IF _priorities_exist THEN
    SELECT pr.id INTO _default_priority_id
    FROM priorities pr
    WHERE COALESCE(pr.is_active, true) = true
    ORDER BY COALESCE(pr.value, 999), pr.name
    LIMIT 1;

    -- If no active priority found, try any priority
    IF _default_priority_id IS NULL THEN
      SELECT pr.id INTO _default_priority_id
      FROM priorities pr
      ORDER BY pr.name
      LIMIT 1;
    END IF;
  END IF;

  -- Get default status from project_statuses (fallback: first status for this project)
  IF _project_statuses_exist THEN
    SELECT ps.id INTO _default_status_id
    FROM project_statuses ps
    WHERE ps.project_id = _project_id
    ORDER BY COALESCE(ps.sort_order, 999), ps.name
    LIMIT 1;
  END IF;

  -- Validate that we have required defaults if tables exist
  IF _priorities_exist AND _default_priority_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No priorities found in database. Please create at least one priority.',
      'body', json_build_object('imported_count', 0, 'created_tasks', '[]'::json),
      'import_errors', json_build_array(json_build_object('error', 'No priorities available')),
      'validation_warnings', '[]'::json,
      'done', true,
      'project_name', (SELECT p.name FROM projects p WHERE p.id = _project_id)
    );
  END IF;

  IF _project_statuses_exist AND _default_status_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No statuses found for this project. Please create at least one status.',
      'body', json_build_object('imported_count', 0, 'created_tasks', '[]'::json),
      'import_errors', json_build_array(json_build_object('error', 'No project statuses available')),
      'validation_warnings', '[]'::json,
      'done', true,
      'project_name', (SELECT p.name FROM projects p WHERE p.id = _project_id)
    );
  END IF;

  -- Process each incoming task
  FOR _task_mapping IN
    SELECT elem
    FROM json_array_elements(_task_mappings) AS elem
  LOOP
    BEGIN
      -- Read values with sane defaults
      _task_name       := trim(((_task_mapping ->> 'name')::text));
      _description     := trim(coalesce(_task_mapping ->> 'description', ''));
      _priority_name   := trim(coalesce(_task_mapping ->> 'priority', 'Medium'));
      _status_name     := trim(coalesce(_task_mapping ->> 'status', 'To Do'));
      _assignee_email  := lower(trim(coalesce(_task_mapping ->> 'assignee', '')));
      _assignee_action := coalesce(_task_mapping ->> 'assigneeAction', 'map');

      -- Due date parsing (optional)
      BEGIN
        IF (_task_mapping ->> 'dueDate') IS NOT NULL AND (_task_mapping ->> 'dueDate') <> '' THEN
          _due_date := (_task_mapping ->> 'dueDate')::date;
        ELSE
          _due_date := NULL;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        _due_date := NULL;
      END;

      -- Validate required fields
      IF _task_name IS NULL OR _task_name = '' THEN
        _errors := array_append(_errors, json_build_object(
          'error', 'Task name is required',
          'task_name', coalesce(_task_name, 'null')
        ));
        CONTINUE;
      END IF;

      -- Resolve priority by name (only if table exists)
      _priority_id := NULL;
      IF _priorities_exist THEN
        SELECT pr.id
        INTO _priority_id
        FROM priorities pr
        WHERE lower(pr.name) = lower(_priority_name)
        LIMIT 1;

        -- Use default if not found
        IF _priority_id IS NULL THEN
          _priority_id := _default_priority_id;
          _warning_list := array_append(_warning_list, json_build_object(
            'type', 'warning',
            'field', 'priority',
            'message', 'Priority "' || _priority_name || '" not found; using default',
            'value', _priority_name,
            'task_name', _task_name
          ));
        END IF;
      END IF;

      -- Resolve status by name from project_statuses (only if table exists)
      _status_id := NULL;
      IF _project_statuses_exist THEN
        SELECT ps.id
        INTO _status_id
        FROM project_statuses ps
        WHERE ps.project_id = _project_id
          AND lower(ps.name) = lower(_status_name)
        LIMIT 1;

        -- Use default if not found
        IF _status_id IS NULL THEN
          _status_id := _default_status_id;
          _warning_list := array_append(_warning_list, json_build_object(
            'type', 'warning',
            'field', 'status',
            'message', 'Status "' || _status_name || '" not found; using default',
            'value', _status_name,
            'task_name', _task_name
          ));
        END IF;
      END IF;

      -- Resolve assignee only when mapping existing users (not creating)
      _team_member_id := NULL;
      _assignee_user_id := NULL;

      IF _assignee_email IS NOT NULL AND _assignee_email <> '' AND _assignee_action <> 'create' THEN
        SELECT u.id INTO _assignee_user_id
        FROM users u
        WHERE lower(u.email) = _assignee_email;

        IF _assignee_user_id IS NOT NULL AND _team_members_exist THEN
          SELECT tm.id INTO _team_member_id
          FROM team_members tm
          WHERE tm.user_id = _assignee_user_id
            AND tm.team_id = _team_id;

          IF _team_member_id IS NULL THEN
            _warning_list := array_append(_warning_list, json_build_object(
              'type', 'warning',
              'field', 'assignee',
              'message', 'User exists but is not a team member',
              'email', _assignee_email,
              'task_name', _task_name
            ));
          END IF;
        ELSIF _assignee_user_id IS NOT NULL AND NOT _team_members_exist THEN
          _warning_list := array_append(_warning_list, json_build_object(
            'type', 'warning',
            'field', 'assignee',
            'message', 'Team members table does not exist; cannot assign user',
            'email', _assignee_email,
            'task_name', _task_name
          ));
        ELSIF _assignee_user_id IS NULL THEN
          _warning_list := array_append(_warning_list, json_build_object(
            'type', 'warning',
            'field', 'assignee',
            'message', 'User with this email not found',
            'email', _assignee_email,
            'task_name', _task_name
          ));
        END IF;
      END IF;

      -- Insert task with required priority_id and status_id
      INSERT INTO tasks (
        project_id,
        name,
        description,
        priority_id,
        status_id,
        end_date,
        reporter_id,
        created_at,
        updated_at
      )
      VALUES (
        _project_id,
        _task_name,
        NULLIF(_description, ''),
        _priority_id,  -- Now guaranteed to be non-null
        _status_id,    -- Now guaranteed to be non-null
        _due_date,
        _created_by,
        NOW(),
        NOW()
      )
      RETURNING id INTO _new_task_id;

      -- If team member resolved and tasks_assignees table exists, add task assignee
      IF _team_member_id IS NOT NULL AND _tasks_assignees_exist THEN
        INSERT INTO tasks_assignees (
          task_id,
          assignee_id,
          created_at,
          updated_at
        ) VALUES (
          _new_task_id,
          _team_member_id,
          NOW(),
          NOW()
        );
      ELSIF _team_member_id IS NOT NULL AND NOT _tasks_assignees_exist THEN
        _warning_list := array_append(_warning_list, json_build_object(
          'type', 'warning',
          'field', 'assignee',
          'message', 'Tasks assignees table does not exist; task created without assignee',
          'email', _assignee_email,
          'task_name', _task_name
        ));
      END IF;

      _created_tasks := array_append(_created_tasks, json_build_object(
        'id', _new_task_id,
        'task_name', _task_name,
        'assignee_email', _assignee_email,
        'status', _status_name,
        'priority', _priority_name
      ));

    EXCEPTION WHEN OTHERS THEN
      _errors := array_append(_errors, json_build_object(
        'error', SQLERRM,
        'task_name', coalesce(_task_name, 'unknown'),
        'sql_state', SQLSTATE
      ));
    END;
  END LOOP;

  RETURN json_build_object(
    'success', coalesce(array_length(_created_tasks, 1), 0) > 0,
    'message',
      CASE WHEN coalesce(array_length(_created_tasks, 1), 0) > 0
           THEN 'Successfully imported ' || array_length(_created_tasks, 1) || ' tasks'
           ELSE 'No tasks were imported' END,
    'body', json_build_object(
      'created_tasks', coalesce(array_to_json(_created_tasks), '[]'::json),
      'imported_count', coalesce(array_length(_created_tasks, 1), 0)
    ),
    'import_errors', coalesce(array_to_json(_errors), '[]'::json),
    'validation_warnings', coalesce(array_to_json(_warning_list), '[]'::json),
    'done', true,
    'project_name', (SELECT p.name FROM projects p WHERE p.id = _project_id)
  );
END;
$function$;
