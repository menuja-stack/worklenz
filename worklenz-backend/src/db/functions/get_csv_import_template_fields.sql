CREATE OR REPLACE FUNCTION get_csv_import_template_fields(_project_id uuid)
RETURNS json AS $$
DECLARE
    _result json;
    _status_count integer;
    _priority_count integer;
    _member_count integer;
BEGIN
    -- Validate project exists
    IF NOT EXISTS (SELECT 1 FROM projects WHERE id = _project_id) THEN
        RAISE EXCEPTION 'Project not found: %', _project_id;
    END IF;

    -- Get counts for debugging (with error handling)
    BEGIN
        SELECT COUNT(*) INTO _status_count FROM task_statuses WHERE project_id = _project_id;
    EXCEPTION WHEN OTHERS THEN
        _status_count := 0;
        RAISE NOTICE 'Error counting task_statuses: %', SQLERRM;
    END;

    BEGIN
        SELECT COUNT(*) INTO _priority_count FROM priorities WHERE is_active = true;
    EXCEPTION WHEN OTHERS THEN
        _priority_count := 0;
        RAISE NOTICE 'Error counting priorities: %', SQLERRM;
    END;

    BEGIN
        SELECT COUNT(*) INTO _member_count 
        FROM project_members 
        WHERE project_id = _project_id AND is_active = true;
    EXCEPTION WHEN OTHERS THEN
        _member_count := 0;
        RAISE NOTICE 'Error counting project_members: %', SQLERRM;
    END;

    -- Log counts
    RAISE NOTICE 'Found % statuses, % priorities, % members for project %', 
        _status_count, _priority_count, _member_count, _project_id;

    SELECT json_build_object(
        'project_statuses', COALESCE((
            SELECT json_agg(status_data)
            FROM (
                SELECT 
                    ts.id,
                    ts.name,
                    ts.category_id as category,
                    COALESCE(ts.sort_order, 0) as sort_order,
                    EXISTS (
                        SELECT 1 
                        FROM sys_task_status_categories stsc 
                        WHERE stsc.id = ts.category_id 
                        AND stsc.is_done IS TRUE
                    ) as is_done
                FROM task_statuses ts
                WHERE ts.project_id = _project_id
                ORDER BY ts.sort_order
            ) status_data
        ), '[]'::json),
        'priorities', COALESCE((
            SELECT json_agg(priority_data)
            FROM (
                SELECT 
                    p.id,
                    p.name,
                    COALESCE(p.value, 0) as value,
                    COALESCE(p.color, '#808080') as color
                FROM priorities p
                WHERE COALESCE(p.is_active, true) = true
                ORDER BY p.value
            ) priority_data
        ), '[]'::json),
        'team_members', COALESCE((
            SELECT json_agg(member_data)
            FROM (
                SELECT 
                    u.id,
                    COALESCE(u.display_name, u.email) as name,
                    u.email,
                    u.avatar_url
                FROM project_members pm
                JOIN users u ON u.id = pm.user_id
                WHERE pm.project_id = _project_id
                AND pm.is_active = true
                ORDER BY u.display_name NULLS LAST
            ) member_data
        ), '[]'::json),
        'debug_info', json_build_object(
            'status_count', _status_count,
            'priority_count', _priority_count,
            'member_count', _member_count
        )
    ) INTO _result;

    RETURN _result;

EXCEPTION WHEN OTHERS THEN
    -- Log error details
    RAISE NOTICE 'Error in get_csv_import_template_fields: %', SQLERRM;
    RETURN json_build_object(
        'error', SQLERRM,
        'project_id', _project_id,
        'debug_info', json_build_object(
            'status_count', _status_count,
            'priority_count', _priority_count,
            'member_count', _member_count
        )
    );
END;
$$ LANGUAGE plpgsql;