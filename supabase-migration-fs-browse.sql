-- Run this manually in the Supabase SQL Editor — DO NOT execute via code.
-- Migration for: Drives-page Finder browser (live folder listing)
-- Created: 2026-07-11
--
-- The Drives page "Browse" (Finder) window asks a live scanner for the
-- contents of a folder on a connected drive. The round-trip reuses the
-- existing download_commands queue:
--   portal POST /api/fs-browse  → inserts command 'list_directory'
--   scanner poll                → lists the folder, PATCHes the row with
--                                 status='completed' + result JSONB
--   portal GET /api/fs-browse   → polls the row until result appears
--
-- Until this migration is applied, POST /api/fs-browse returns a
-- "server not ready" error (the command CHECK constraint rejects
-- 'list_directory') — downloads and everything else keep working.

-- ============================================================================
-- Column: download_commands.result
-- Scanner-written JSONB result payload for query-style commands.
-- For list_directory: { path, drive_label, entries: [{name, is_dir, size,
-- mtime}], total_items, truncated }
-- ============================================================================
ALTER TABLE download_commands ADD COLUMN IF NOT EXISTS result JSONB;

-- ============================================================================
-- Allow the 'list_directory' command on the existing download_commands queue.
-- Recreated from the live 7-value list (see supabase-migration-project-
-- locations.sql, applied 2026-06-21) + 'list_directory'.
-- ============================================================================
ALTER TABLE download_commands DROP CONSTRAINT IF EXISTS download_commands_command_check;
ALTER TABLE download_commands ADD CONSTRAINT download_commands_command_check
  CHECK (command IN ('add_to_cloud','start_download','cancel_download','copy_to_drive','delete_data','check_cloud_status','locate','list_directory'));
