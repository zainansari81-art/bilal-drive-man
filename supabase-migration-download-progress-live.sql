-- Run this in Supabase SQL Editor
-- Migration for: live download progress (current-file + speed) feature
-- Created: 2026-04-29
--
-- This table is a high-frequency mirror of in-flight download state
-- emitted by the scanner's live_progress helper (~1.5s cadence) so the
-- portal can render per-file progress + current/avg speed without
-- waiting on the existing 10s download_projects polling loop.
--
-- DESIGN NOTES (so future-you doesn't break things by "improving" this):
--
-- 1. Separate table on purpose — does NOT touch download_projects, which
--    remains the source of truth. If this whole feature gets disabled,
--    nothing in the existing flow cares whether this table has rows.
--
-- 2. PRIMARY KEY = project_id so the scanner can upsert with
--    on_conflict=project_id and we always have at most one live row
--    per project. (We don't keep history here; download_projects has
--    started_at/completed_at + the existing progress_bytes column.)
--
-- 3. Foreign-key ON DELETE CASCADE so removing a project from the
--    portal cleans up its live row too.
--
-- 4. BIGINT for byte/speed columns — wedding shoots regularly cross 100GB
--    and a fast LAN-tethered Dropbox sync can show speeds well past INT
--    range when measured in bits/sec.

CREATE TABLE IF NOT EXISTS download_progress_live (
  project_id           UUID PRIMARY KEY REFERENCES download_projects(id) ON DELETE CASCADE,
  -- Per-file detail (GDrive direct download exposes these; Dropbox
  -- folder-size sampling leaves them NULL — UI handles both).
  current_file_name    TEXT,
  current_file_index   INTEGER,
  total_files          INTEGER,
  current_file_bytes   BIGINT,
  current_file_size    BIGINT,
  -- Aggregate progress (always populated when the live row exists).
  cumulative_bytes     BIGINT,
  total_bytes          BIGINT,
  -- Speed metrics, all in bytes-per-second.
  --   instant_speed_bps  : last sample window (~1.5s)
  --   rolling_avg_bps    : last ~10s
  --   true_avg_bps       : cumulative_bytes / (sampled_at - started_at)
  instant_speed_bps    BIGINT,
  rolling_avg_bps      BIGINT,
  true_avg_bps         BIGINT,
  -- Mirrors download_projects.download_phase ('gdrive_staging',
  -- 'syncing', 'copying', etc.) plus a 'complete' terminal value the
  -- scanner posts once when the download finishes — used by the UI to
  -- freeze the card in "Done — averaged X" mode.
  phase                TEXT,
  -- 'gdrive' | 'dropbox' | 'wetransfer' — UI uses this to decide whether
  -- to show file-level detail or aggregate-only.
  source               TEXT,
  -- Timestamps: started_at is set once on first emit, sampled_at on
  -- every emit, completed_at on the terminal post.
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sampled_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

-- We always look up by project_id (PK) so no extra indexes needed.
-- The PK already enforces uniqueness for upserts.
