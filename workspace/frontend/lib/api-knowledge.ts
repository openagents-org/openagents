import { supabase } from './supabase';

export interface KnowledgeNode {
  id: string;
  title: string;
  slug: string;
  content: string;
  contentType: 'markdown' | 'reference' | 'summary';
  knowledgeType: 'global' | 'project';
  projectId: string | null;
  parentId: string | null;
  category: string | null;
  position: number;
  isFolder: boolean;
  children?: KnowledgeNode[];
  createdBy: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Mock data – used as fallback when Supabase is unavailable
// ---------------------------------------------------------------------------

const MOCK_DATA: KnowledgeNode[] = [
  // Global Knowledge
  {
    id: 'g-folder-1',
    title: '产品方法论',
    slug: 'product-methodology',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: null,
    category: 'prd',
    position: 0,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-20T10:00:00Z',
  },
  {
    id: 'g-entry-1',
    title: 'PRD撰写指导',
    slug: 'prd-writing-guide',
    content: '# PRD撰写指导\n\n## 目的\n确保产品需求文档的完整性和规范性。\n\n## 结构\n1. 背景与目标\n2. 用户场景\n3. 功能需求\n4. 非功能需求\n5. 验收标准\n\n## 注意事项\n- 每个需求必须有明确的验收标准\n- 使用用户故事格式描述需求\n- 附带线框图或原型链接',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-1',
    category: 'prd',
    position: 0,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-18T14:30:00Z',
  },
  {
    id: 'g-entry-2',
    title: '评审流程标准',
    slug: 'review-process',
    content: '# 评审流程标准\n\n## 评审类型\n- 需求评审\n- 设计评审\n- 代码评审\n- 上线评审\n\n## 流程\n1. 发起人提前1天发出评审材料\n2. 参与人提前阅读材料并准备问题\n3. 评审会议不超过1小时\n4. 会后24小时内发出结论和Action Items',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-1',
    category: 'prd',
    position: 1,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-15T09:00:00Z',
  },
  {
    id: 'g-folder-2',
    title: '技术规范',
    slug: 'tech-specs',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: null,
    category: 'api',
    position: 1,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-19T08:00:00Z',
  },
  {
    id: 'g-entry-3',
    title: 'API设计规范',
    slug: 'api-design-spec',
    content: '# API设计规范\n\n## RESTful 原则\n- 使用名词复数作为资源路径\n- HTTP方法语义：GET/POST/PUT/DELETE\n- 版本号放在URL中：`/v1/resources`\n\n## 响应格式\n```json\n{\n  "code": 0,\n  "message": "success",\n  "data": {}\n}\n```\n\n## 错误处理\n- 400: 请求参数错误\n- 401: 未认证\n- 403: 无权限\n- 404: 资源不存在\n- 500: 服务器内部错误',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-2',
    category: 'api',
    position: 0,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-17T11:00:00Z',
  },
  {
    id: 'g-entry-4',
    title: '前端代码规范',
    slug: 'frontend-code-spec',
    content: '# 前端代码规范\n\n## 组件规范\n- 使用函数式组件 + Hooks\n- Props 接口以 `Props` 后缀命名\n- 单一职责：一个组件只做一件事\n\n## 命名规范\n- 组件文件：kebab-case (e.g. `user-profile.tsx`)\n- 组件名：PascalCase\n- hooks：camelCase，以 `use` 开头\n\n## 样式\n- 使用 Tailwind CSS\n- 语义化颜色 token\n- 响应式优先',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-2',
    category: 'api',
    position: 1,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-16T16:00:00Z',
  },
  {
    id: 'g-folder-3',
    title: '团队协作',
    slug: 'team-collaboration',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: null,
    category: 'meeting',
    position: 2,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-14T10:00:00Z',
  },
  {
    id: 'g-entry-5',
    title: '会议纪要模板',
    slug: 'meeting-notes-template',
    content: '# 会议纪要模板\n\n## 基本信息\n- **日期**：\n- **参与人**：\n- **主持人**：\n\n## 议题\n1. ...\n\n## 讨论要点\n- ...\n\n## 决议\n- ...\n\n## Action Items\n| 事项 | 负责人 | 截止日期 |\n|------|--------|----------|\n| ... | ... | ... |',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-3',
    category: 'meeting',
    position: 0,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-12T13:00:00Z',
  },
  // Project Knowledge (Mobile Redesign)
  {
    id: 'p-folder-1',
    title: 'PRD',
    slug: 'mobile-prd',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-mobile-redesign',
    parentId: null,
    category: 'prd',
    position: 0,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-22T10:00:00Z',
  },
  {
    id: 'p-entry-1',
    title: '移动端重设计需求文档',
    slug: 'mobile-redesign-prd',
    content: '# 移动端重设计需求文档\n\n## 背景\n当前移动端体验评分低于行业平均，需要进行全面重设计。\n\n## 目标\n- 提升用户满意度至4.5/5\n- 核心操作路径缩短30%\n- 新用户激活率提升20%\n\n## 核心功能\n1. 首页信息流重构\n2. 导航系统简化\n3. 个人中心改版\n4. 搜索体验优化',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-mobile-redesign',
    parentId: 'p-folder-1',
    category: 'prd',
    position: 0,
    isFolder: false,
    createdBy: 'pm-lead',
    updatedAt: '2026-05-21T15:00:00Z',
  },
  {
    id: 'p-folder-2',
    title: '设计规范',
    slug: 'mobile-design-spec',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-mobile-redesign',
    parentId: null,
    category: 'design',
    position: 1,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-20T09:00:00Z',
  },
  {
    id: 'p-entry-2',
    title: 'UI组件库规范',
    slug: 'ui-component-spec',
    content: '# UI组件库规范\n\n## 设计 Token\n- 主色：#6366F1\n- 成功色：#10B981\n- 警告色：#F59E0B\n- 错误色：#EF4444\n\n## 组件列表\n- Button (Primary, Secondary, Ghost)\n- Input (Text, Search, Textarea)\n- Card (Standard, Compact, Interactive)\n- Modal (Alert, Confirm, Form)\n\n## 间距系统\n- xs: 4px\n- sm: 8px\n- md: 16px\n- lg: 24px\n- xl: 32px',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-mobile-redesign',
    parentId: 'p-folder-2',
    category: 'design',
    position: 0,
    isFolder: false,
    createdBy: 'designer',
    updatedAt: '2026-05-19T14:00:00Z',
  },
  {
    id: 'p-folder-3',
    title: '架构决策',
    slug: 'mobile-architecture',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-mobile-redesign',
    parentId: null,
    category: 'architecture',
    position: 2,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-18T11:00:00Z',
  },
  {
    id: 'p-entry-3',
    title: '技术选型记录',
    slug: 'tech-stack-decision',
    content: '# 技术选型记录\n\n## 决策日期\n2026-05-10\n\n## 参与人\n前端负责人、架构师、CTO\n\n## 方案对比\n| 方案 | 优点 | 缺点 |\n|------|------|------|\n| React Native | 跨平台复用 | 性能受限 |\n| Flutter | 高性能 | 生态较小 |\n| Swift/Kotlin | 原生性能 | 需双端维护 |\n\n## 最终决策\n采用 React Native + 关键模块原生桥接方案。\n\n## 理由\n- 团队已有 React 经验\n- 80%页面不需要极致性能\n- 通过原生桥接解决关键性能瓶颈',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-mobile-redesign',
    parentId: 'p-folder-3',
    category: 'architecture',
    position: 0,
    isFolder: false,
    createdBy: 'tech-lead',
    updatedAt: '2026-05-10T16:00:00Z',
  },
];

// Mock project list for dropdown selectors
export const MOCK_PROJECTS = [
  { id: 'proj-mobile-redesign', name: 'Mobile Redesign' },
];

// ---------------------------------------------------------------------------
// Helper: build tree from flat list
// ---------------------------------------------------------------------------

function buildTree(nodes: KnowledgeNode[]): KnowledgeNode[] {
  const map = new Map<string, KnowledgeNode>();
  const roots: KnowledgeNode[] = [];

  // Clone nodes with empty children arrays
  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }

  Array.from(map.values()).forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort by position
  const sortByPosition = (a: KnowledgeNode, b: KnowledgeNode) => a.position - b.position;
  roots.sort(sortByPosition);
  Array.from(map.values()).forEach((node) => {
    if (node.children && node.children.length > 0) {
      node.children.sort(sortByPosition);
    }
  });

  return roots;
}

// ---------------------------------------------------------------------------
// Helper: convert Supabase row to KnowledgeNode
// ---------------------------------------------------------------------------

interface SupabaseKnowledgeRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  slug: string;
  content: string | null;
  content_type: string;
  knowledge_type: string;
  category: string | null;
  position: number;
  is_folder: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToNode(row: SupabaseKnowledgeRow): KnowledgeNode {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    content: row.content || '',
    contentType: row.content_type as KnowledgeNode['contentType'],
    knowledgeType: row.knowledge_type as KnowledgeNode['knowledgeType'],
    projectId: row.project_id,
    parentId: row.parent_id,
    category: row.category,
    position: row.position,
    isFolder: row.is_folder,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

function nodeToRow(node: Partial<KnowledgeNode>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (node.title !== undefined) row.title = node.title;
  if (node.slug !== undefined) row.slug = node.slug;
  if (node.content !== undefined) row.content = node.content;
  if (node.contentType !== undefined) row.content_type = node.contentType;
  if (node.knowledgeType !== undefined) row.knowledge_type = node.knowledgeType;
  if (node.projectId !== undefined) row.project_id = node.projectId;
  if (node.parentId !== undefined) row.parent_id = node.parentId;
  if (node.category !== undefined) row.category = node.category;
  if (node.position !== undefined) row.position = node.position;
  if (node.isFolder !== undefined) row.is_folder = node.isFolder;
  if (node.createdBy !== undefined) row.created_by = node.createdBy;
  return row;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Fetch entire knowledge tree for a workspace, organized hierarchically.
 * Falls back to mock data if Supabase is unavailable.
 */
export async function fetchKnowledgeTree(workspaceId: string): Promise<KnowledgeNode[]> {
  try {
    const { data, error } = await supabase
      .from('knowledge_tree')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No data');

    const nodes = (data as SupabaseKnowledgeRow[]).map(rowToNode);
    return buildTree(nodes);
  } catch {
    // Fallback to mock data
    return buildTree(MOCK_DATA);
  }
}

/**
 * Create a new knowledge entry.
 */
export async function createKnowledgeEntry(
  entry: Partial<KnowledgeNode> & { workspaceId?: string }
): Promise<KnowledgeNode> {
  try {
    const slug = entry.slug || entry.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'untitled';
    const row = {
      ...nodeToRow(entry),
      slug,
      workspace_id: entry.workspaceId || 'default',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('knowledge_tree')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return rowToNode(data as SupabaseKnowledgeRow);
  } catch {
    // Fallback: return a mock-created node
    const newNode: KnowledgeNode = {
      id: `local-${Date.now()}`,
      title: entry.title || 'Untitled',
      slug: entry.slug || entry.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'untitled',
      content: entry.content || '',
      contentType: entry.contentType || 'markdown',
      knowledgeType: entry.knowledgeType || 'global',
      projectId: entry.projectId || null,
      parentId: entry.parentId || null,
      category: entry.category || null,
      position: entry.position || 0,
      isFolder: entry.isFolder || false,
      createdBy: entry.createdBy || null,
      updatedAt: new Date().toISOString(),
    };
    return newNode;
  }
}

/**
 * Update an existing knowledge entry.
 */
export async function updateKnowledgeEntry(
  id: string,
  updates: Partial<KnowledgeNode>
): Promise<KnowledgeNode> {
  try {
    const row = {
      ...nodeToRow(updates),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('knowledge_tree')
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return rowToNode(data as SupabaseKnowledgeRow);
  } catch {
    // Fallback: return updates merged with a placeholder
    return {
      id,
      title: updates.title || 'Updated',
      slug: updates.slug || 'updated',
      content: updates.content || '',
      contentType: updates.contentType || 'markdown',
      knowledgeType: updates.knowledgeType || 'global',
      projectId: updates.projectId || null,
      parentId: updates.parentId || null,
      category: updates.category || null,
      position: updates.position || 0,
      isFolder: updates.isFolder || false,
      createdBy: updates.createdBy || null,
      updatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Delete a knowledge entry (and its children cascade on DB).
 */
export async function deleteKnowledgeEntry(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('knowledge_tree')
      .delete()
      .eq('id', id);

    if (error) throw error;
  } catch {
    // Silently fail in mock mode
  }
}

/**
 * Get the content of a specific knowledge entry.
 */
export async function getKnowledgeContent(id: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('knowledge_tree')
      .select('content')
      .eq('id', id)
      .single();

    if (error) throw error;
    return (data as { content: string | null }).content || '';
  } catch {
    // Fallback: find in mock data
    const mockEntry = MOCK_DATA.find((n) => n.id === id);
    return mockEntry?.content || '';
  }
}
