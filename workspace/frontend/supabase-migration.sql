-- =====================================================================
-- OpenAgents Tools 能力层 - Supabase SQL Migration
-- 在 Supabase Dashboard → SQL Editor 执行此文件
-- =====================================================================

-- ====================================
-- Tasks table
-- ====================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  channel_id TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'blocked')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  task_type TEXT DEFAULT 'human' CHECK (task_type IN ('human', 'agent')),
  assignee_type TEXT DEFAULT 'human' CHECK (assignee_type IN ('human', 'agent')),
  assignee TEXT,
  parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  tags JSONB DEFAULT '[]'::JSONB,
  due_date TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  agent_result JSONB,
  agent_confidence FLOAT,
  created_by TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_type, assignee);

-- ====================================
-- Knowledge entries (tree structure)
-- ====================================
CREATE TABLE IF NOT EXISTS knowledge_tree (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  parent_id UUID REFERENCES knowledge_tree(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT DEFAULT '',
  content_type TEXT DEFAULT 'markdown' CHECK (content_type IN ('markdown', 'reference', 'summary', 'json')),
  knowledge_type TEXT DEFAULT 'global' CHECK (knowledge_type IN ('global', 'project')),
  category TEXT,
  position INTEGER DEFAULT 0,
  is_folder BOOLEAN DEFAULT FALSE,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_tree_workspace ON knowledge_tree(workspace_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_tree_project ON knowledge_tree(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_tree_parent ON knowledge_tree(parent_id);

-- ====================================
-- Inbox items
-- ====================================
CREATE TABLE IF NOT EXISTS inbox_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('task', 'routine', 'system', 'agent')),
  source_id UUID,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  category TEXT DEFAULT 'info' CHECK (category IN ('info', 'success', 'warning', 'error', 'action_required')),
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  action_url TEXT,
  action_label TEXT,
  agent_name TEXT,
  channel_id TEXT,
  project_id TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace ON inbox_items(workspace_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_items_source ON inbox_items(source_type, source_id);

-- ====================================
-- Routines v2
-- ====================================
CREATE TABLE IF NOT EXISTS routines_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  routine_type TEXT DEFAULT 'custom' CHECK (routine_type IN ('daily_summary', 'todo_sync', 'standup', 'weekly_review', 'custom')),
  message TEXT NOT NULL,
  context TEXT,
  schedule_hour INTEGER DEFAULT 9,
  schedule_minute INTEGER DEFAULT 0,
  schedule_days INTEGER[] DEFAULT '{0,1,2,3,4,5,6}',
  schedule_interval_minutes INTEGER,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  last_output JSONB,
  output_channel TEXT,
  created_by TEXT NOT NULL,
  last_fired_at TIMESTAMPTZ,
  next_fires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routines_v2_workspace ON routines_v2(workspace_id, status);

-- ====================================
-- Skill installs tracking
-- ====================================
CREATE TABLE IF NOT EXISTS skill_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  skill_slug TEXT NOT NULL,
  skill_source TEXT DEFAULT 'local' CHECK (skill_source IN ('local', 'skillhub')),
  category TEXT,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, skill_slug)
);

-- ====================================
-- Enable RLS on all tables (optional, enable if auth needed)
-- ====================================
-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE knowledge_tree ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inbox_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE routines_v2 ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE skill_installs ENABLE ROW LEVEL SECURITY;

-- For now, allow full access (development mode)
-- You can add RLS policies later when auth is set up
