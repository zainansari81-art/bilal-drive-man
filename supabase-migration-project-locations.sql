-- Run this manually in the Supabase SQL Editor — DO NOT execute via code.
-- Migration for: FDM "locate" flow — project_locations table
-- Created: 2026-06-21
--
-- Populated by the FDM (downloading machine) when it receives a `locate`
-- command. The scanner name-searches connected Drive/Dropbox accounts for
-- a project's client/couple and writes matching folder rows here.
-- The portal reads these rows read-only and displays them on the project card.
-- Each `locate` run REPLACES all rows for that project_id (delete + re-insert).

-- ============================================================================
-- Table: project_locations
-- Drive/Dropbox folders found by the FDM for a given download project
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_locations (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID         NOT NULL,
  provider     TEXT         CHECK (provider IN ('google_drive', 'dropbox')),
  account_email TEXT,
  account_label TEXT,
  path         TEXT,
  item_id      TEXT,
  file_count   INTEGER,
  total_bytes  BIGINT,
  matched_on   TEXT,
  machine_name TEXT,
  found_at     TIMESTAMPTZ  DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_project_locations_project_id ON project_locations(project_id);

-- ============================================================================
-- Row Level Security
-- Enable RLS but allow all operations (we use service key)
-- ============================================================================
ALTER TABLE project_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all select on project_locations" ON project_locations FOR SELECT USING (true);
CREATE POLICY "Allow all insert on project_locations" ON project_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on project_locations" ON project_locations FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on project_locations" ON project_locations FOR DELETE USING (true);

-- ============================================================================
-- Allow the 'locate' command on the existing download_commands queue.
-- Recreated from the LIVE constraint (which had been widened directly in the
-- SQL editor to 6 values — the repo's supabase-migration-downloading-pro.sql
-- still shows a stale 4-value list) + 'locate'. Applied 2026-06-21.
-- ============================================================================
ALTER TABLE download_commands DROP CONSTRAINT IF EXISTS download_commands_command_check;
ALTER TABLE download_commands ADD CONSTRAINT download_commands_command_check
  CHECK (command IN ('add_to_cloud','start_download','cancel_download','copy_to_drive','delete_data','check_cloud_status','locate'));
