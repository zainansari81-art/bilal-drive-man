-- Run this in Supabase SQL Editor
-- Migration for: Gap 4 — server-side cap on scanner resume retries
-- Created: 2026-04-24

-- ============================================================================
-- Add resume attempt tracking columns to download_projects
-- ============================================================================
-- resume_attempts: incremented every time scanner-resume-check returns this
--   project to a scanner. When the counter reaches MAX_RESUME_ATTEMPTS (3),
--   the endpoint flips the project to 'failed' and stops returning it.
-- last_resume_at: timestamp of most recent increment, for observability.
ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS resume_attempts INT DEFAULT 0;
ALTER TABLE download_projects ADD COLUMN IF NOT EXISTS last_resume_at TIMESTAMPTZ;

-- ============================================================================
-- Reset counters for any existing in-flight projects so the cap doesn't trip
-- immediately on the first scanner boot after this migration lands.
-- ============================================================================
UPDATE download_projects
SET resume_attempts = 0, last_resume_at = NULL
WHERE download_status IN ('downloading', 'copying', 'paused');
