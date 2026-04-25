-- Run this in Supabase SQL Editor
-- Migration for: scanner v3.46.1 — report total expected bytes up-front so
-- the portal can render bytes_done/bytes_total progress during gdrive direct-
-- download staging (before any single file has completed).
-- Created: 2026-04-25

-- ============================================================================
-- Add total_bytes_expected column to download_projects
-- ============================================================================
-- Populated by the scanner's /api/download-progress call right after the
-- gdrive folder listing completes. For dropbox projects this stays NULL
-- (we only know total bytes *during* sync, not up front). Portal should
-- fall back to progress_bytes-only rendering when total_bytes_expected
-- is NULL.

ALTER TABLE download_projects
  ADD COLUMN IF NOT EXISTS total_bytes_expected BIGINT;

-- BIGINT because a Drive folder can easily exceed 4GB (INT max).
-- NULL default on purpose — existing rows are unaffected.
