-- Run this in Supabase SQL Editor
-- Add project_date, size_gb columns and update link_type constraint

-- Add new columns
ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS project_date DATE;
ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS size_gb TEXT;

-- Update link_type to allow 'wetransfer'
ALTER TABLE download_projects DROP CONSTRAINT IF EXISTS download_projects_link_type_check;
ALTER TABLE download_projects ADD CONSTRAINT download_projects_link_type_check
  CHECK (link_type IN ('dropbox', 'google_drive', 'wetransfer', 'unknown'));
