-- Add missing columns to priorities table if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'priorities' AND column_name = 'is_active') THEN
        ALTER TABLE priorities ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;

    -- Add other required columns if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'priorities' AND column_name = 'color') THEN
        ALTER TABLE priorities ADD COLUMN color VARCHAR(7);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'priorities' AND column_name = 'value') THEN
        ALTER TABLE priorities ADD COLUMN value INTEGER;
    END IF;
END$$;

-- Create indices for better performance
CREATE INDEX IF NOT EXISTS idx_priorities_is_active ON priorities(is_active);
CREATE INDEX IF NOT EXISTS idx_project_statuses_project_id ON project_statuses(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id, is_active);