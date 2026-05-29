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
  // Global Knowledge — 产品需求
  {
    id: 'g-folder-1',
    title: '产品需求',
    slug: 'product-requirements',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: null,
    category: 'prd',
    position: 0,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-25T10:00:00Z',
  },
  {
    id: 'g-entry-1',
    title: '精选技能圈选策略PRD',
    slug: 'skill-selection-strategy-prd',
    content: '# 精选技能圈选策略PRD\n\n## 背景\n元宝精选技能需要建立一套系统化的圈选机制，从 SkillHub 海量技能中筛选出高质量、高匹配度的技能推荐给用户。当前缺少统一的评估标准和自动化流程，导致人工运营成本高、上架效率低。\n\n## 目标\n- 建立技能质量评分体系（覆盖率、好评率、完成率三维度）\n- 实现自动化圈选 pipeline，将人工审核环节缩减至终审\n- 首批圈选目标：从 2000+ 技能中精选 Top 50 上架精选页\n\n## 核心策略\n1. **质量门槛筛选**：调用量 >500/周、好评率 >85%、完成率 >90%\n2. **类目覆盖平衡**：确保每个一级类目至少 3 个技能入选\n3. **时效性加权**：近 7 天活跃度占总分 40%',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-1',
    category: 'prd',
    position: 0,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-24T14:30:00Z',
  },
  {
    id: 'g-entry-2',
    title: '微信聊天记录转发元宝派PRD',
    slug: 'wechat-forward-yuanbao-prd',
    content: '# 微信聊天记录转发元宝派PRD\n\n## 背景\n用户在微信群聊中产生大量有价值的对话内容，但缺少便捷方式将这些内容结构化并交由 AI 处理。通过"转发到元宝"功能，用户可以将微信聊天记录一键发送给元宝派，由 AI 自动摘要、分类和归档。\n\n## 用户场景\n- 产品经理转发需求讨论记录，让元宝生成结构化需求列表\n- 运营同学转发用户反馈，让元宝归类并统计高频问题\n- 团队 leader 转发会议讨论，让元宝输出会议纪要和 Action Items\n\n## 技术方案\n微信开放平台消息回调 → 消息解析服务 → 元宝对话引擎 → 结果回传微信/存入知识库。消息解析需处理文本、图片、语音、文件等多模态内容，统一转为 Markdown 格式输入。',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-1',
    category: 'prd',
    position: 1,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-22T09:00:00Z',
  },
  {
    id: 'g-entry-3',
    title: '2026高考元宝公开派方案',
    slug: 'gaokao-yuanbao-2026',
    content: '# 2026高考元宝公开派方案\n\n## 项目概述\n针对 2026 年高考场景，元宝公开派将提供一整套考生服务解决方案，包含志愿填报辅助、成绩预估、院校匹配推荐等核心能力。项目目标是在高考季（6月-7月）期间实现日活 50 万、用户留存率 >35%。\n\n## 核心功能模块\n1. **智能志愿填报**：基于分数线历史数据 + 考生成绩，推荐"冲/稳/保"三档院校\n2. **群聊情境引导**：在考生家长群中通过情境化对话自然引入元宝服务\n3. **分级引导机制**：根据用户对话深度分为浅层问答、中层咨询、深层规划三个层级\n\n## 用户吸引与留存策略\n- 考前阶段：每日一题冲刺打卡，形成习惯\n- 出分阶段：第一时间推送分数线对比工具\n- 填报阶段：一对一志愿规划会话，提升深度使用',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-1',
    category: 'prd',
    position: 2,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-20T11:00:00Z',
  },
  // Global Knowledge — 技术规范
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
    updatedAt: '2026-05-23T08:00:00Z',
  },
  {
    id: 'g-entry-4',
    title: 'SkillHub API 接口规范',
    slug: 'skillhub-api-reference',
    content: '# SkillHub API 接口规范\n\n## 概述\nSkillHub API 提供技能发现、安装、调用和管理的完整接口。所有接口遵循 RESTful 设计原则，使用 JSON 格式通信，基于 OAuth 2.0 进行鉴权。\n\n## 核心接口\n- `GET /v1/skills` — 技能列表查询，支持分页、分类筛选、关键词搜索\n- `POST /v1/skills/:id/invoke` — 技能调用，传入参数后异步返回结果\n- `GET /v1/skills/:id/metrics` — 获取技能运行指标（调用量、延迟、成功率）\n\n## 鉴权方式\n请求头携带 `Authorization: Bearer <access_token>`，Token 有效期 2 小时，过期后通过 refresh_token 刷新。所有写操作需额外携带 `X-Workspace-Id` 标识工作空间归属。',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-2',
    category: 'api',
    position: 0,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-21T11:00:00Z',
  },
  {
    id: 'g-entry-5',
    title: 'Skill 写作指南',
    slug: 'skill-writing-guide',
    content: '# Skill 写作指南\n\n## 设计原则\n一个好的 Skill 应该做到：单一职责、输入输出明确、错误处理完善、可组合可复用。Skill 本质上是一段可被 AI Agent 调用的能力单元，其 System Prompt 决定了行为边界。\n\n## Prompt 结构\n每个 Skill 的 System Prompt 包含四段：\n1. **角色定义**：明确 Skill 扮演的专家角色\n2. **能力边界**：列举可做和不可做的事项\n3. **输出格式**：规定返回结果的结构（JSON Schema / Markdown 等）\n4. **示例对话**：2-3 个 few-shot 示例确保行为一致性\n\n## 发布规范\n- slug 使用 kebab-case，长度不超过 48 字符\n- 描述字段必须包含一句话摘要 + 适用场景列表\n- 每次更新需附带 changelog，版本号遵循 SemVer',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-2',
    category: 'api',
    position: 1,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-19T16:00:00Z',
  },
  {
    id: 'g-entry-6',
    title: '考点时序编排与埋点设计',
    slug: 'test-point-timing-tracking',
    content: '# 考点时序编排与埋点设计\n\n## 背景\nVIP 项目中长程跑团场景需要精细化的考点覆盖和时序控制。每个考点在对话流中的触发时机、持续时长、退出条件都需要明确定义，同时通过埋点数据验证实际覆盖情况。\n\n## 时序编排规则\n- 每轮对话最多触发 2 个考点，避免信息过载\n- 高优先级考点在对话前 3 轮内必须覆盖\n- 考点之间设置最小间隔（至少 1 轮对话）\n\n## 埋点设计\n关键埋点事件：`test_point_triggered`（考点触发）、`test_point_completed`（考点完成）、`test_point_skipped`（考点跳过）。每个事件携带 session_id、point_id、trigger_round、user_response_quality 字段，用于后续覆盖率统计和策略优化。',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-2',
    category: 'api',
    position: 2,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-17T14:00:00Z',
  },
  // Global Knowledge — 设计资源
  {
    id: 'g-folder-3',
    title: '设计资源',
    slug: 'design-resources',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: null,
    category: 'design',
    position: 2,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-18T10:00:00Z',
  },
  {
    id: 'g-entry-7',
    title: 'PRD撰写指导方法',
    slug: 'prd-writing-methodology',
    content: '# PRD撰写指导方法\n\n## 核心框架\n一份合格的 PRD 需要回答三个根本问题：为谁解决什么问题（Why）、用什么方案解决（What）、如何衡量解决效果（How）。文档结构应当服务于这三个问题的层层展开。\n\n## 撰写流程\n1. **需求收集**：从用户反馈、数据分析、竞品调研三个渠道汇总原始需求\n2. **需求分析**：用 RICE 模型（Reach × Impact × Confidence / Effort）排优先级\n3. **方案设计**：产出用户故事地图 + 核心流程图 + 交互原型\n4. **文档撰写**：按模板填充各章节，确保每个功能点有验收标准\n5. **评审迭代**：发起跨职能评审，收集反馈后修订至少一轮\n\n## 常见问题\n- 避免"大而全"：单篇 PRD 聚焦一个用户目标，超过 20 页考虑拆分\n- 避免实现细节：PRD 描述"做什么"而非"怎么做"，技术方案另开文档',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-3',
    category: 'design',
    position: 0,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-16T13:00:00Z',
  },
  {
    id: 'g-entry-8',
    title: '元宝同行者灵魂宪章',
    slug: 'yuanbao-companion-charter',
    content: '# 元宝同行者灵魂宪章\n\n## 设计理念\n元宝同行者不是冰冷的工具，而是用户数字生活中的伙伴。它的性格基调是：温暖但不谄媚、专业但不傲慢、主动但不侵扰。所有交互设计都应围绕"同行"这一核心隐喻展开。\n\n## 人格维度\n- **共情力**：能识别用户情绪状态，在低落时给予鼓励，在焦虑时帮助梳理\n- **边界感**：不主动询问隐私信息，不在用户明确拒绝后继续推荐\n- **成长性**：随着交互积累，对用户偏好的理解越来越准确\n\n## 视觉与语言风格\n视觉上采用圆润、柔和的形态语言，避免尖锐几何和过度装饰。文案风格口语化，句式简短，多用"我们"而非"您应该"。错误提示用引导式而非告知式（"试试这样？"而非"操作失败"）。',
    contentType: 'markdown',
    knowledgeType: 'global',
    projectId: null,
    parentId: 'g-folder-3',
    category: 'design',
    position: 1,
    isFolder: false,
    createdBy: 'admin',
    updatedAt: '2026-05-14T10:00:00Z',
  },
  // Project Knowledge (OpenAgents Workspace)
  {
    id: 'p-folder-1',
    title: 'One Agent Prompt',
    slug: 'one-agent-prompt',
    content: '',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-openagents',
    parentId: null,
    category: 'prd',
    position: 0,
    isFolder: true,
    createdBy: null,
    updatedAt: '2026-05-26T10:00:00Z',
  },
  {
    id: 'p-entry-1',
    title: '单聊 in OneAgent 系统提示词',
    slug: 'one-agent-system-prompt',
    content: '# 单聊 in OneAgent 系统提示词\n\n## 设计目标\nOneAgent 单聊模式的 System Prompt 需要实现：一个统一的 AI 入口，根据用户意图自动路由到对应 Skill，同时保持连贯的对话体验。用户感知不到"切换"，只觉得在和一个全能助手交流。\n\n## 架构要点\n- 意图识别层：前 2 轮对话内判断用户需求类型（闲聊/任务/查询/创作）\n- Skill 路由层：匹配最合适的 Skill 执行，支持 fallback 到通用对话\n- 上下文管理：跨 Skill 调用时保持对话历史，避免用户重复描述背景\n\n## 综合版特性\n综合版在基础单聊之上增加了记忆模块接入，可以引用用户历史偏好和长期画像信息，实现个性化响应。记忆触发条件：用户提及过往经历、表达固定偏好、或连续 3 次进入同一场景。',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-openagents',
    parentId: 'p-folder-1',
    category: 'prd',
    position: 0,
    isFolder: false,
    createdBy: 'pm-lead',
    updatedAt: '2026-05-25T15:00:00Z',
  },
  {
    id: 'p-entry-2',
    title: '外卖生服场景 SP 扩展',
    slug: 'delivery-service-sp-extension',
    content: '# 外卖生服场景 SP 扩展\n\n## 场景描述\n在外卖生活服务场景中，用户可能咨询配送状态、申请退款、修改订单、评价商家等。SP 扩展模块为这些高频场景提供专属的对话策略和工具调用能力。\n\n## 能力清单\n- 订单状态查询：调用订单系统 API，返回实时配送进度\n- 智能催单：根据超时程度自动选择温和催促/正式投诉话术\n- 退款辅助：引导用户提供退款凭证，自动填充退款申请表单\n- 商家评价引导：在配送完成后适时引导评价，提升评价率\n\n## 记忆集成\n完整版 SP 接入用户记忆模块后，可以记住用户常点的菜品、送餐地址偏好、过敏信息等，在后续对话中主动提供个性化建议（如"您上次点的那家湘菜今天有新品"）。',
    contentType: 'markdown',
    knowledgeType: 'project',
    projectId: 'proj-openagents',
    parentId: 'p-folder-1',
    category: 'prd',
    position: 1,
    isFolder: false,
    createdBy: 'pm-lead',
    updatedAt: '2026-05-23T11:00:00Z',
  },
];

// Mock project list for dropdown selectors
export const MOCK_PROJECTS = [
  { id: 'proj-openagents', name: 'OpenAgents Workspace' },
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
