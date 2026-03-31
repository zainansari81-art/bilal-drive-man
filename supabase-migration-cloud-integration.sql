-- Run this in Supabase SQL Editor
-- Migration for: Cloud Integration + Pause/Resume support
-- Created: 2026-03-31

-- ============================================================================
-- Update download_status constraint to include 'paused'
-- ============================================================================
ALTER TABLE download_projects DROP CONSTRAINT IF EXISTS download_projects_download_status_check;
ALTER TABLE download_projects ADD CONSTRAINT download_projects_download_status_check
  CHECK (download_status IN ('idle', 'queued', 'downloading', 'paused', 'copying', 'completed', 'failed'));

-- ============================================================================
-- Add error_message column to download_projects if not exists
-- ============================================================================
ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS error_message TEXT;

-- ============================================================================
-- Add progress_bytes column alias (some APIs use this name)
-- ============================================================================
ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS progress_bytes BIGINT DEFAULT 0;
