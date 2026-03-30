-- Run this in Supabase SQL Editor
-- Migration for: Downloading-Pro feature
-- Created: 2026-03-30

-- ============================================================================
-- Table: cloud_accounts
-- Multiple Dropbox and Google Drive accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS cloud_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('dropbox', 'google_drive')),
  email TEXT,
  local_sync_path TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- Table: download_projects
-- Projects fetched from Notion for downloading
-- ============================================================================
CREATE TABLE IF NOT EXISTS download_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_page_id TEXT UNIQUE,
  client_name TEXT NOT NULL,
  couple_name TEXT NOT NULL,
  download_link TEXT,
  link_type TEXT CHECK (link_type IN ('dropbox', 'google_drive', 'unknown')),
  cloud_account_id UUID REFERENCES cloud_accounts(id),
  cloud_status TEXT DEFAULT 'pending' CHECK (cloud_status IN ('pending', 'connected', 'syncing', 'error')),
  cloud_folder_path TEXT,
  cloud_size_bytes BIGINT DEFAULT 0,
  download_status TEXT DEFAULT 'idle' CHECK (download_status IN ('idle', 'queued', 'downloading', 'copying', 'completed', 'failed')),
  download_progress_bytes BIGINT DEFAULT 0,
  assigned_machine TEXT,
  target_drive TEXT,
  queue_position INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- Table: download_commands
-- Commands sent to scanner agents
-- ============================================================================
CREATE TABLE IF NOT EXISTS download_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_name TEXT NOT NULL,
  command TEXT NOT NULL CHECK (command IN ('add_to_cloud', 'start_download', 'cancel_download', 'copy_to_drive')),
  project_id UUID REFERENCES download_projects(id) ON DELETE CASCADE,
  payload JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acked', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- Table: download_machines
-- Track which machines are download-capable
-- ============================================================================
CREATE TABLE IF NOT EXISTS download_machines (
  machine_name TEXT PRIMARY KEY,
  is_download_pc BOOLEAN DEFAULT false,
  max_concurrent INTEGER DEFAULT 1,
  dropbox_path TEXT,
  gdrive_path TEXT,
  current_downloads INTEGER DEFAULT 0,
  last_seen TIMESTAMPTZ
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_download_projects_status ON download_projects(download_status);
CREATE INDEX IF NOT EXISTS idx_download_projects_machine ON download_projects(assigned_machine);
CREATE INDEX IF NOT EXISTS idx_download_projects_cloud_account ON download_projects(cloud_account_id);
CREATE INDEX IF NOT EXISTS idx_download_commands_machine_status ON download_commands(machine_name, status);
CREATE INDEX IF NOT EXISTS idx_cloud_accounts_type ON cloud_accounts(account_type);

-- ============================================================================
-- Row Level Security
-- Enable RLS but allow all operations (we use service key)
-- ============================================================================

ALTER TABLE cloud_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_machines ENABLE ROW LEVEL SECURITY;

-- Policies for cloud_accounts
CREATE POLICY "Allow all select on cloud_accounts" ON cloud_accounts FOR SELECT USING (true);
CREATE POLICY "Allow all insert on cloud_accounts" ON cloud_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on cloud_accounts" ON cloud_accounts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on cloud_accounts" ON cloud_accounts FOR DELETE USING (true);

-- Policies for download_projects
CREATE POLICY "Allow all select on download_projects" ON download_projects FOR SELECT USING (true);
CREATE POLICY "Allow all insert on download_projects" ON download_projects FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on download_projects" ON download_projects FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on download_projects" ON download_projects FOR DELETE USING (true);

-- Policies for download_commands
CREATE POLICY "Allow all select on download_commands" ON download_commands FOR SELECT USING (true);
CREATE POLICY "Allow all insert on download_commands" ON download_commands FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on download_commands" ON download_commands FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on download_commands" ON download_commands FOR DELETE USING (true);

-- Policies for download_machines
CREATE POLICY "Allow all select on download_machines" ON download_machines FOR SELECT USING (true);
CREATE POLICY "Allow all insert on download_machines" ON download_machines FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on download_machines" ON download_machines FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on download_machines" ON download_machines FOR DELETE USING (true);
