-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 2026-05-04 — add `is_ignored` flag to drives table
-- ─────────────────────────────────────────────────────────────────────────
--
-- Lets the user mark specific drives as "ignored permanently" via the
-- portal UI. Ignored drives are hidden from the connected-drives list,
-- the wizard's target_drive picker, and stat counts. The scanner still
-- detects them physically (so heartbeat data isn't lost) but their rows
-- are filtered out of every read path.
--
-- Idempotent — safe to re-run.
--
-- Apply via Supabase Studio → SQL Editor (paste this whole file, click Run)
-- OR via psql with the connection string from project settings.
--
ALTER TABLE drives
  ADD COLUMN IF NOT EXISTS is_ignored BOOLEAN NOT NULL DEFAULT false;

-- Partial index so the common "fetch non-ignored drives" query is fast.
CREATE INDEX IF NOT EXISTS idx_drives_visible
  ON drives(volume_label)
  WHERE is_ignored = false;

-- Scanner UPSERTs use `merge-duplicates` and only send the columns it
-- knows about (volume_label, total_size_bytes, used_bytes, free_bytes,
-- is_connected, drive_letter, last_seen, last_scan, source_machine).
-- Since `is_ignored` is NOT in that list, scanner re-syncs preserve
-- the user's choice automatically — no scanner change needed.

-- Sanity check (uncomment to verify):
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'drives' AND column_name = 'is_ignored';
