-- Run this in the Supabase SQL Editor.
-- Adds a `download_phase` column so the scanner can report sub-states while
-- the high-level `download_status` is still 'downloading' or 'copying'.
-- Values the scanner writes:
--   'pinning'   -- files queued for offline sync in the cloud app
--   'syncing'   -- bytes pulling down from cloud to PC
--   'copying'   -- moving local files onto the target drive
--   NULL        -- idle / done / scanner hasn't set it yet

ALTER TABLE download_projects
  ADD COLUMN IF NOT EXISTS download_phase TEXT;

ALTER TABLE download_projects
  DROP CONSTRAINT IF EXISTS download_projects_download_phase_check;

ALTER TABLE download_projects
  ADD CONSTRAINT download_projects_download_phase_check
  CHECK (download_phase IS NULL OR download_phase IN ('pinning', 'syncing', 'copying'));
