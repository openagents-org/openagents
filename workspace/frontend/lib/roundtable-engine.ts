import { ROUNDTABLE_PRESET_AGENTS } from './roundtable-preset-agents';

export type RoundtablePhaseId =
  | 'round1'
  | 'round2'
  | 'round3'
  | 'round4'
  | 'round5'
  | 'round6'
  | 'round7';

export type RoundtableStatus = 'idle' | 'running' | 'paused' | 'complete';

export type RoundtableAgentRuntime = 'demo' | 'codex_cli' | 'claude_code_cli';
export type RoundtableAgentKind = 'public_figure' | 'functional' | 'chair' | 'judge' | 'custom';
export type RoundtableParticipationMode = 'participant' | 'background_research' | 'judge' | 'chair';
export type RoundtableSkillLoadStatus =
  | 'legacy_prompt'
  | 'not_installed'
  | 'installed'
  | 'verified_loaded'
  | 'load_failed'
  | 'draft_skill';

export interface RoundtableQualityScores {
  persona?: number;
  evidence?: number;
  intensity?: number;
  actionability?: number;
}

export type InteractionType =
  | 'statement'
  | 'mention'
  | 'reply'
  | 'challenge'
  | 'evidence_request'
  | 'synthesis'
  | 'user_interjection';

export type FactEntryType =
  | 'background'
  | 'known_fact'
  | 'source'
  | 'uncertainty'
  | 'evidence_request';

export type FactEntryStatus =
  | 'verified'
  | 'unverified'
  | 'assumption'
  | 'needs_evidence';

export interface RoundtablePhase {
  id: RoundtablePhaseId;
  title: string;
  shortTitle: string;
  instruction: string;
}

export interface RoundtableAgent {
  id: string;
  name: string;
  avatar: string;
  roleLabel: string;
  roleDescription: string;
  responsibility: string;
  skillContent: string;
  agentKind: RoundtableAgentKind;
  participationMode: RoundtableParticipationMode;
  skillId?: string;
  skillSourcePath?: string;
  skillLoadStatus: RoundtableSkillLoadStatus;
  corpusPath?: string;
  sourceManifestPath?: string;
  qualityScores?: RoundtableQualityScores;
  avatarSource?: string;
  enabled: boolean;
  runtime: RoundtableAgentRuntime;
}

export interface FactPackEntry {
  id: string;
  type: FactEntryType;
  content: string;
  source: string;
  status: FactEntryStatus;
  addedBy: string;
  phaseId?: RoundtablePhaseId;
  createdAt: string;
}

export interface RoundtableMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderRoleLabel: string;
  content: string;
  phaseId: RoundtablePhaseId;
  phaseTitle: string;
  interactionType: InteractionType;
  targetAgentIds: string[];
  relatedIdea?: string;
  evidenceRequest?: string;
  createdAt: string;
}

export interface AgentGenerationContext {
  agent: {
    id: string;
    name: string;
    roleLabel: string;
    roleDescription: string;
    responsibility: string;
    skillContent: string;
  };
  otherParticipants: Array<{
    id: string;
    name: string;
    roleLabel: string;
  }>;
  topic: string;
  objective: string;
  background: string;
  searchScope: string;
  phase: RoundtablePhase;
  factPack: Array<{
    type: FactEntryType;
    content: string;
    source: string;
    status: FactEntryStatus;
  }>;
  publicTranscript: Array<{
    senderName: string;
    phaseTitle: string;
    interactionType: InteractionType;
    content: string;
    targetAgentNames: string[];
  }>;
}

export interface FinalIdea {
  title: string;
  supportingReasons: string[];
  objections: string[];
  keyRisks: string[];
}

export interface RoundtableFinalOutput {
  ideas: FinalIdea[];
  consensus: string[];
  disagreements: string[];
  openQuestions: string[];
  nextSteps: string[];
}

export interface InteractionEdge {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  type: InteractionType;
  phaseId: RoundtablePhaseId;
}

export interface RoundtableState {
  topic: string;
  objective: string;
  background: string;
  searchScope: string;
  agents: RoundtableAgent[];
  selectedAgentIds: string[];
  currentPhaseId: RoundtablePhaseId;
  status: RoundtableStatus;
  factPack: FactPackEntry[];
  messages: RoundtableMessage[];
  finalOutput: RoundtableFinalOutput | null;
  pendingExtraRoundSuggestion: string | null;
  extraRoundCount: number;
}

export const ROUNDTABLE_PHASES: RoundtablePhase[] = [
  {
    id: 'round1',
    title: '第 1 轮：初始观点',
    shortTitle: '初始观点',
    instruction: '给出初始立场，说明支持理由，暴露关键假设，并提出需要验证的问题。',
  },
  {
    id: 'round2',
    title: '第 2 轮：相互挑战',
    shortTitle: '相互挑战',
    instruction: '挑战另一位 Agent，点名回应对象，并指出缺失证据或薄弱假设。',
  },
  {
    id: 'round3',
    title: '第 3 轮：修正观点',
    shortTitle: '修正观点',
    instruction: '回应挑战，修正观点，并说明仍需验证的内容。',
  },
  {
    id: 'round4',
    title: '第 4 轮：证据深挖',
    shortTitle: '证据深挖',
    instruction: '围绕最关键的不确定性继续追问，要求对方给证据、指标、边界或失败判据。',
  },
  {
    id: 'round5',
    title: '第 5 轮：取舍谈判',
    shortTitle: '取舍谈判',
    instruction: '把想法压到资源取舍、负责人、时间窗口和不可做事项上。',
  },
  {
    id: 'round6',
    title: '第 6 轮：最终立场',
    shortTitle: '最终立场',
    instruction: '每个 Agent 给出最终支持、反对或有条件支持，并说明一个必须验证的硬指标。',
  },
  {
    id: 'round7',
    title: '第 7 轮：收敛总结',
    shortTitle: '收敛总结',
    instruction: '基于全程真实发言，总结想法、支持理由、反对意见、风险、共识、分歧和下一步行动。',
  },
];

const DEFAULT_SEARCH_SCOPE = '仅使用手动事实包。联网搜索暂未接入。';

export const DEFAULT_SELECTED_AGENT_IDS = [
  'musk-first-principles-perspective',
  'bezos-customer-flywheel-perspective',
  'jobs-product-narrative-perspective',
  'thiel-contrarian-monopoly-perspective',
  'grove-strategic-inflection-perspective',
  'walton-channel-execution-perspective',
  'drucker-management-critic-perspective',
];

const interactionTypeLabels: Record<InteractionType, string> = {
  statement: '陈述',
  mention: '提及',
  reply: '回应',
  challenge: '挑战',
  evidence_request: '证据请求',
  synthesis: '收敛总结',
  user_interjection: '用户插话',
};

const factTypeLabels: Record<FactEntryType, string> = {
  background: '背景',
  known_fact: '已知事实',
  source: '来源',
  uncertainty: '不确定项',
  evidence_request: '证据请求',
};

const factStatusLabels: Record<FactEntryStatus, string> = {
  verified: '已验证',
  unverified: '未验证',
  assumption: '假设',
  needs_evidence: '需要证据',
};

let idCounter = 0;

function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function phaseById(phaseId: RoundtablePhaseId): RoundtablePhase {
  return ROUNDTABLE_PHASES.find((phase) => phase.id === phaseId) || ROUNDTABLE_PHASES[0];
}

function normalizeName(name: string): string {
  return name.trim() || 'agent';
}

function targetForAgent(agents: RoundtableAgent[], index: number): RoundtableAgent | null {
  if (agents.length < 2) return null;
  return agents[(index + 1) % agents.length];
}

function previousForAgent(agents: RoundtableAgent[], index: number): RoundtableAgent | null {
  if (agents.length < 2) return null;
  return agents[(index - 1 + agents.length) % agents.length];
}

function hasVerifiedEvidenceUpdate(state: RoundtableState): boolean {
  return state.factPack.some((entry) =>
    entry.status === 'verified' &&
    /update|evidence|source|interview|validated|证据|来源|访谈|验证|更新/i.test(entry.content + entry.source)
  );
}

export function createRoundtableAgent(input: Partial<RoundtableAgent> = {}): RoundtableAgent {
  const name = normalizeName(input.name || '新 Agent');
  return {
    id: input.id || makeId('agent'),
    name,
    avatar: input.avatar || name.slice(0, 1).toUpperCase(),
    roleLabel: input.roleLabel || '圆桌成员',
    roleDescription: input.roleDescription || '为圆桌讨论贡献一个清晰且不同的视角。',
    responsibility: input.responsibility || '提出观点、发起挑战、修正判断，并帮助小组收敛。',
    skillContent: input.skillContent || '# Skill\n只使用你自己的角色设定和会议职责参与讨论。',
    agentKind: input.agentKind || 'custom',
    participationMode: input.participationMode || 'participant',
    skillId: input.skillId,
    skillSourcePath: input.skillSourcePath,
    skillLoadStatus: input.skillLoadStatus || (input.skillSourcePath ? 'installed' : 'legacy_prompt'),
    corpusPath: input.corpusPath,
    sourceManifestPath: input.sourceManifestPath,
    qualityScores: input.qualityScores,
    avatarSource: input.avatarSource,
    enabled: input.enabled ?? true,
    runtime: input.runtime || 'demo',
  };
}

export function createDemoAgents(): RoundtableAgent[] {
  return ROUNDTABLE_PRESET_AGENTS.map((agent) => createRoundtableAgent({
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    roleLabel: agent.roleLabel,
    roleDescription: agent.roleDescription,
    responsibility: agent.responsibility,
    skillContent: agent.skillContent,
    agentKind: agent.agentKind,
    participationMode: agent.participationMode,
    skillId: agent.skillId,
    skillSourcePath: agent.skillSourcePath,
    skillLoadStatus: agent.skillLoadStatus,
    corpusPath: agent.corpusPath,
    sourceManifestPath: agent.sourceManifestPath,
    qualityScores: agent.qualityScores,
    avatarSource: agent.avatarSource,
    runtime: agent.runtime,
    enabled: true,
  }));
}

export function ensurePresetRoundtableAgents(state: RoundtableState): RoundtableState {
  const presetAgents = createDemoAgents();
  const presetIds = new Set(presetAgents.map((agent) => agent.id));
  const customAgents = state.agents.filter((agent) => !presetIds.has(agent.id));
  const customSelected = state.selectedAgentIds.filter((id) => !presetIds.has(id));
  const presetSelected = state.selectedAgentIds.filter((id) => presetIds.has(id));
  const selectedAllPresets = presetSelected.length === presetAgents.length;
  const selectedPresetIds = selectedAllPresets || presetSelected.length === 0
    ? DEFAULT_SELECTED_AGENT_IDS
    : presetSelected;

  return {
    ...state,
    agents: [...presetAgents, ...customAgents],
    selectedAgentIds: [
      ...selectedPresetIds.filter((id) => presetIds.has(id)),
      ...customSelected.filter((id) => customAgents.some((agent) => agent.id === id)),
    ],
  };
}

export function createEmptyRoundtableState(): RoundtableState {
  const agents = createDemoAgents();
  return {
    topic: 'AI 原生产品的商业化策略讨论',
    objective: '识别最具潜力的商业模式，评估关键风险，形成可执行的下一步建议。',
    background: '中国市场，AI 原生应用，B2B 与 B2C 探索范围；公开网络、行业报告、产品案例作为参考来源。',
    searchScope: DEFAULT_SEARCH_SCOPE,
    agents,
    selectedAgentIds: DEFAULT_SELECTED_AGENT_IDS.filter((id) => agents.some((agent) => agent.id === id)),
    currentPhaseId: 'round1',
    status: 'idle',
    factPack: [
      {
        id: makeId('fact'),
        type: 'known_fact',
        content: '2024 年中国 AI 应用市场规模约 200 亿元。',
        source: '艾瑞咨询（2024 中国人工智能应用研究报告）',
        status: 'verified',
        addedBy: 'demo',
        createdAt: nowIso(),
      },
      {
        id: makeId('fact'),
        type: 'known_fact',
        content: '生产力工具类应用年增长率约 35%。',
        source: 'IDC（2024 中国企业应用市场跟踪报告）',
        status: 'verified',
        addedBy: 'demo',
        createdAt: nowIso(),
      },
      {
        id: makeId('fact'),
        type: 'uncertainty',
        content: '企业用户付费意愿存在较大差异。',
        source: '公开访谈与桌面研究',
        status: 'unverified',
        addedBy: 'demo',
        createdAt: nowIso(),
      },
    ],
    messages: [],
    finalOutput: null,
    pendingExtraRoundSuggestion: null,
    extraRoundCount: 0,
  };
}

export function getSelectedAgents(state: RoundtableState): RoundtableAgent[] {
  const selected = new Set(state.selectedAgentIds);
  return state.agents.filter((agent) => agent.enabled && selected.has(agent.id));
}

export function addFactEntry(
  state: RoundtableState,
  input: Omit<Partial<FactPackEntry>, 'id' | 'createdAt'> & Pick<FactPackEntry, 'content'>,
): RoundtableState {
  const hasSource = !!input.source?.trim();
  const requestedStatus = input.status || (hasSource ? 'verified' : 'unverified');
  const status = requestedStatus === 'verified' && !hasSource ? 'unverified' : requestedStatus;
  const type = input.type || 'known_fact';
  return {
    ...state,
    factPack: [
      ...state.factPack,
      {
        id: makeId('fact'),
        type,
        content: input.content.trim(),
        source: (input.source || '').trim(),
        status,
        addedBy: input.addedBy || 'human',
        phaseId: input.phaseId,
        createdAt: nowIso(),
      },
    ].filter((entry) => entry.content.length > 0),
  };
}

export function updateAgent(
  state: RoundtableState,
  agentId: string,
  updates: Partial<RoundtableAgent>,
): RoundtableState {
  return {
    ...state,
    agents: state.agents.map((agent) =>
      agent.id === agentId ? { ...agent, ...updates, name: updates.name ? normalizeName(updates.name) : agent.name } : agent
    ),
  };
}

export function deleteAgent(state: RoundtableState, agentId: string): RoundtableState {
  return {
    ...state,
    agents: state.agents.filter((agent) => agent.id !== agentId),
    selectedAgentIds: state.selectedAgentIds.filter((id) => id !== agentId),
  };
}

export function addAgent(state: RoundtableState, agent?: Partial<RoundtableAgent>): RoundtableState {
  const created = createRoundtableAgent(agent);
  return {
    ...state,
    agents: [...state.agents, created],
    selectedAgentIds: [...state.selectedAgentIds, created.id],
  };
}

export function buildAgentGenerationContext(
  state: RoundtableState,
  agentId: string,
  phaseId: RoundtablePhaseId = state.currentPhaseId,
): AgentGenerationContext {
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const selectedAgents = getSelectedAgents(state);
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      roleLabel: agent.roleLabel,
      roleDescription: agent.roleDescription,
      responsibility: agent.responsibility,
      skillContent: agent.skillContent,
    },
    otherParticipants: selectedAgents
      .filter((item) => item.id !== agent.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        roleLabel: item.roleLabel,
      })),
    topic: state.topic,
    objective: state.objective,
    background: state.background,
    searchScope: state.searchScope,
    phase: phaseById(phaseId),
    factPack: state.factPack.map((entry) => ({
      type: entry.type,
      content: entry.content,
      source: entry.source,
      status: entry.status,
    })),
    publicTranscript: state.messages.map((message) => ({
      senderName: message.senderName,
      phaseTitle: message.phaseTitle,
      interactionType: message.interactionType,
      content: message.content,
      targetAgentNames: message.targetAgentIds
        .map((targetId) => state.agents.find((agentItem) => agentItem.id === targetId)?.name)
        .filter((name): name is string => !!name),
    })),
  };
}

export function renderAgentPrompt(context: AgentGenerationContext): string {
  const factLines = context.factPack.length
    ? context.factPack.map((entry) =>
      `- [${factStatusLabels[entry.status]}] ${factTypeLabels[entry.type]}：${entry.content}${entry.source ? ` 来源：${entry.source}` : ' 来源：无'}`
    ).join('\n')
    : '- 事实包暂无条目。所有缺少来源的内容都应视为未验证。';

  const participantLines = context.otherParticipants.length
    ? context.otherParticipants.map((agent) => `- ${agent.name}: ${agent.roleLabel}`).join('\n')
    : '- 暂无其他已选参与者。';

  const transcriptLines = context.publicTranscript.length
    ? context.publicTranscript.map((message) =>
      `- ${message.phaseTitle} / ${message.senderName} / ${interactionTypeLabels[message.interactionType]}：${message.content}`
    ).join('\n')
    : '- 暂无公开群聊记录。';

  return [
    `你是 ${context.agent.name}。`,
    `角色标签：${context.agent.roleLabel}`,
    `角色描述：${context.agent.roleDescription}`,
    `会议职责：${context.agent.responsibility}`,
    '',
    '执行约束：',
    '- 先把私有 Skill 当作该 Agent 的操作系统使用，再组织本轮发言；不要只套姓名和角色标签。',
    '- 发言必须体现私有 Skill 中的心智模型、决策启发式、表达 DNA 和诚实边界。',
    '- 不说“我以某某视角”“非本人观点”“目标对象：”“你的挑战成立”等 AI 协作套话。',
    '- 如果证据不足，只能给已知事实、候选假设、验证路径或临时止血方案，并标注未证实。',
    '- 每轮都要和上一轮公开发言发生关系：回应、反驳、追问或修正，不能孤立输出泛泛观点。',
    '',
    '仅供该 Agent 使用的私有 Skill 内容：',
    context.agent.skillContent,
    '',
    `讨论议题：${context.topic || '未设置'}`,
    `会议目标：${context.objective || '未设置'}`,
    `背景材料：${context.background || '无'}`,
    `搜索范围：${context.searchScope || DEFAULT_SEARCH_SCOPE}`,
    '',
    `当前阶段：${context.phase.title}`,
    `阶段指令：${context.phase.instruction}`,
    '',
    '其他参与者（仅公开姓名和角色标签）：',
    participantLines,
    '',
    '事实包：',
    factLines,
    '',
    '公开群聊记录：',
    transcriptLines,
  ].join('\n');
}

function createMessage(
  state: RoundtableState,
  agent: RoundtableAgent,
  phaseId: RoundtablePhaseId,
  content: string,
  interactionType: InteractionType,
  targetAgentIds: string[] = [],
  relatedIdea?: string,
  evidenceRequest?: string,
): RoundtableMessage {
  const phase = phaseById(phaseId);
  return {
    id: makeId('msg'),
    senderId: agent.id,
    senderName: agent.name,
    senderAvatar: agent.avatar,
    senderRoleLabel: agent.roleLabel,
    content,
    phaseId,
    phaseTitle: phase.title,
    interactionType,
    targetAgentIds,
    relatedIdea,
    evidenceRequest,
    createdAt: nowIso(),
  };
}

function generateRound1Messages(state: RoundtableState, agents: RoundtableAgent[]): RoundtableMessage[] {
  return agents.map((agent, index) => {
    const idea = `${agent.roleLabel}想法 ${index + 1}`;
    const content = [
      `${state.topic || '当前议题'}先不要做成大而全的方案。`,
      `我会从“${agent.roleLabel}”这条线押一个小赌注：${agent.responsibility}`,
      `它必须服务会议目标“${state.objective || '未设置'}”，否则就该被砍掉。`,
      '在进入决策前，事实包里的弱证据要先被挑出来。',
    ].join(' ');
    return createMessage(state, agent, 'round1', content, 'statement', [], idea);
  });
}

function generateRound2Messages(state: RoundtableState, agents: RoundtableAgent[]): {
  messages: RoundtableMessage[];
  factPack: FactPackEntry[];
} {
  const messages: RoundtableMessage[] = [];
  let nextState = state;
  agents.forEach((agent, index) => {
    const target = targetForAgent(agents, index);
    if (!target) {
      messages.push(createMessage(
        state,
        agent,
        'round2',
        '当前没有其他已选 Agent，因此我无法挑战具体对象。',
        'challenge',
      ));
      return;
    }

    if (index === 0) {
      const evidenceRequest = `证据请求：验证 ${target.name} 观点背后最强的客户证据或执行证据。`;
      messages.push(createMessage(
        state,
        agent,
        'round2',
        `@${target.name} 先别把这个方向当成可执行结论。请区分已观察事实和假设，并说明最快的验证路径。`,
        'evidence_request',
        [target.id],
        `${target.roleLabel}假设`,
        evidenceRequest,
      ));
      nextState = addFactEntry(nextState, {
        type: 'evidence_request',
        content: evidenceRequest,
        source: '',
        status: 'needs_evidence',
        addedBy: agent.name,
        phaseId: 'round2',
      });
      return;
    }

    messages.push(createMessage(
      state,
      agent,
      'round2',
      `@${target.name} 这个假设太快了。在成为候选想法前，它需要更清晰的用户价值、执行路径和下行风险。`,
      'challenge',
      [target.id],
      `${target.roleLabel}挑战`,
    ));
  });

  return { messages, factPack: nextState.factPack };
}

function generateRound3Messages(state: RoundtableState, agents: RoundtableAgent[]): RoundtableMessage[] {
  const hasUpdate = hasVerifiedEvidenceUpdate(state);
  const phaseId = state.currentPhaseId;
  return agents.map((agent, index) => {
    const target = phaseId === 'round4'
      ? targetForAgent(agents, index + 1)
      : previousForAgent(agents, index);
    const targetText = target ? `@${target.name} ` : '';
    const interactionType: InteractionType = phaseId === 'round4'
      ? 'evidence_request'
      : phaseId === 'round5'
        ? 'challenge'
        : 'reply';
    const factText = hasUpdate
      ? '事实包已有更新，小组可以引用一条具体验证路径。'
      : '事实包仍未补齐，这个判断只能保持有条件。';
    const content = phaseId === 'round4'
      ? [
        `${targetText}我需要把这个判断压到证据上。`,
        '请给出指标、样本、时间窗口、责任人、失败判据和合规边界。',
        factText,
      ].join(' ')
      : phaseId === 'round5'
        ? [
          `${targetText}这里必须做取舍。`,
          '如果资源只能支持一条路径，我会砍掉最难验证的假设，把投入转到最早能暴露客户或执行真相的动作。',
          factText,
        ].join(' ')
        : phaseId === 'round6'
          ? [
            `${targetText}我的最终立场是有条件推进。`,
            '保留这个想法，但只给一个短验证窗口；指标不动，就停止扩大投入。',
            factText,
          ].join(' ')
          : [
            `${targetText}上一轮有一部分击中了问题，我会收窄判断。`,
            factText,
            '只有当下一步验证可以快速完成时，我才建议继续保留这个想法。',
          ].join(' ');
    return createMessage(
      state,
      agent,
      phaseId,
      content,
      interactionType,
      target ? [target.id] : [],
      `${agent.roleLabel}修正`,
    );
  });
}

function chooseSynthesizer(agents: RoundtableAgent[]): RoundtableAgent | null {
  return agents.find((agent) => /chair|synth|summary|consensus|主持|收敛|总结|共识/i.test(
    `${agent.name} ${agent.roleLabel} ${agent.responsibility}`
  )) || agents[0] || null;
}

function compactMessageContent(content: string, maxLength = 180): string {
  const compact = content
    .replace(/\[Runtime:[^\]]+\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function messagesForAgent(state: RoundtableState, agentId: string): RoundtableMessage[] {
  return state.messages.filter((message) => message.senderId === agentId);
}

function firstMessageOfType(
  messages: RoundtableMessage[],
  types: InteractionType[],
): RoundtableMessage | undefined {
  return messages.find((message) => types.includes(message.interactionType));
}

export function buildFinalOutput(state: RoundtableState): RoundtableFinalOutput {
  const selectedAgents = getSelectedAgents(state);
  const verifiedFacts = state.factPack.filter((entry) => entry.status === 'verified');
  const openEvidence = state.factPack.filter((entry) => entry.status !== 'verified');
  const challengeMessages = state.messages.filter((message) => message.interactionType === 'challenge');
  const evidenceMessages = state.messages.filter((message) => message.interactionType === 'evidence_request');
  const synthesisMessages = state.messages.filter((message) => message.interactionType === 'synthesis');
  const ideas = selectedAgents.map((agent, index) => ({
    title: firstMessageOfType(messagesForAgent(state, agent.id), ['statement', 'synthesis'])
      ? `${agent.name}的主张 ${index + 1}`
      : `${agent.roleLabel}方案 ${index + 1}`,
    supportingReasons: [
      firstMessageOfType(messagesForAgent(state, agent.id), ['statement'])
        ? compactMessageContent(firstMessageOfType(messagesForAgent(state, agent.id), ['statement'])!.content)
        : `${agent.name} 提供了与会议目标“${state.objective || '未设置'}”相关的角色视角。`,
      verifiedFacts[0]
        ? `事实包支持：${verifiedFacts[0].content}`
        : '当前支持理由主要来自讨论逻辑，应标记为未验证。',
    ],
    objections: [
      firstMessageOfType(messagesForAgent(state, agent.id), ['challenge', 'reply'])
        ? compactMessageContent(firstMessageOfType(messagesForAgent(state, agent.id), ['challenge', 'reply'])!.content)
        : (challengeMessages[0]
          ? compactMessageContent(challengeMessages[0].content)
          : '小组需要更多证据后才能把它当作决策。'),
      challengeMessages[1]
        ? compactMessageContent(challengeMessages[1].content)
        : '执行可行性和客户价值需要更清晰的验证。',
    ],
    keyRisks: [
      openEvidence[0]
        ? `开放证据缺口：${openEvidence[0].content}`
        : '如果事实包不更新，存在过度自信风险。',
      evidenceMessages[0]
        ? compactMessageContent(evidenceMessages[0].content)
        : '如果缺少近期验证负责人，这个想法可能过宽。',
    ],
  }));

  return {
    ideas,
    consensus: [
      synthesisMessages[0]
        ? compactMessageContent(synthesisMessages[0].content)
        : '以事实包作为共享证据边界。',
      verifiedFacts[0]
        ? `已验证事实边界：${verifiedFacts[0].content}`
        : '只保留能够快速验证的大胆想法。',
    ],
    disagreements: [
      challengeMessages[0]
        ? compactMessageContent(challengeMessages[0].content)
        : '各 Agent 对优先大胆程度、执行确定性还是证据深度仍有分歧。',
      challengeMessages[1]
        ? compactMessageContent(challengeMessages[1].content)
        : '仍需更多交锋来判断分歧强度。',
    ],
    openQuestions: openEvidence.length
      ? openEvidence.map((entry) => entry.content)
      : evidenceMessages.length
        ? evidenceMessages.map((message) => compactMessageContent(message.content))
        : ['哪条证据能最快证伪当前领先想法？'],
    nextSteps: [
      evidenceMessages[0]
        ? compactMessageContent(evidenceMessages[0].content)
        : '为最重要的验证问题指定负责人。',
      '把每个领先主张压成指标、负责人、时间窗口和失败判据。',
      '如果新证据改变最强想法，追加一轮跟进讨论。',
    ],
  };
}

function generateSynthesisMessages(state: RoundtableState, agents: RoundtableAgent[]): RoundtableMessage[] {
  const synthesizer = chooseSynthesizer(agents);
  if (!synthesizer) return [];
  const finalPhaseId = ROUNDTABLE_PHASES.at(-1)?.id || 'round7';
  const finalOutput = buildFinalOutput(state);
  const content = [
    '我先把这桌讨论收住：最强的想法必须同时经得起理由、反对意见和近期验证。',
    `现在真正站得住的是：${finalOutput.consensus.join(' ')}`,
    `不要抹平的分歧是：${finalOutput.disagreements.join(' ')}`,
    `下一步只看这个问题：${finalOutput.openQuestions[0] || '暂无'}`,
  ].join(' ');
  return [
    createMessage(state, synthesizer, finalPhaseId, content, 'synthesis', agents
      .filter((agent) => agent.id !== synthesizer.id)
      .map((agent) => agent.id)),
  ];
}

export function advanceRoundtable(state: RoundtableState): RoundtableState {
  if (state.status === 'paused' || state.status === 'complete') return state;

  const agents = getSelectedAgents(state);
  if (agents.length === 0) return state;

  const phaseId = state.currentPhaseId;
  let generatedMessages: RoundtableMessage[] = [];
  let nextFactPack = state.factPack;

  if (phaseId === 'round1') {
    generatedMessages = generateRound1Messages(state, agents);
  } else if (phaseId === 'round2') {
    const generated = generateRound2Messages(state, agents);
    generatedMessages = generated.messages;
    nextFactPack = generated.factPack;
  } else if (phaseId === 'round3') {
    generatedMessages = generateRound3Messages({ ...state, factPack: nextFactPack }, agents);
  } else if (phaseId === 'round7') {
    generatedMessages = generateSynthesisMessages(state, agents);
  } else {
    generatedMessages = generateRound3Messages({ ...state, factPack: nextFactPack }, agents);
  }

  const phaseIndex = ROUNDTABLE_PHASES.findIndex((phase) => phase.id === phaseId);
  const nextPhase = ROUNDTABLE_PHASES[phaseIndex + 1];
  const isFinalPhase = phaseId === (ROUNDTABLE_PHASES.at(-1)?.id || 'round7');
  const updated: RoundtableState = {
    ...state,
    status: isFinalPhase ? 'complete' : 'running',
    factPack: nextFactPack,
    messages: [...state.messages, ...generatedMessages],
    currentPhaseId: nextPhase?.id || (ROUNDTABLE_PHASES.at(-1)?.id || 'round7'),
    pendingExtraRoundSuggestion: isFinalPhase
      ? '如果事实包改变了领先想法，Agent 建议可追加一轮跟进讨论，需要用户确认。'
      : state.pendingExtraRoundSuggestion,
  };

  return isFinalPhase
    ? { ...updated, finalOutput: buildFinalOutput(updated) }
    : updated;
}

export function pauseRoundtable(state: RoundtableState): RoundtableState {
  return state.status === 'complete' ? state : { ...state, status: 'paused' };
}

export function resumeRoundtable(state: RoundtableState): RoundtableState {
  return state.status === 'complete' ? state : { ...state, status: 'running' };
}

export function confirmExtraRound(state: RoundtableState): RoundtableState {
  if (!state.pendingExtraRoundSuggestion) return state;
  return {
    ...state,
    currentPhaseId: 'round2',
    status: 'running',
    finalOutput: null,
    pendingExtraRoundSuggestion: null,
    extraRoundCount: (state.extraRoundCount || 0) + 1,
  };
}

export function addUserInterjection(state: RoundtableState, content: string): RoundtableState {
  const trimmed = content.trim();
  if (!trimmed) return state;
  const phase = phaseById(state.currentPhaseId);
  const message: RoundtableMessage = {
    id: makeId('msg'),
    senderId: 'human',
    senderName: '用户',
    senderAvatar: 'H',
    senderRoleLabel: '人类成员',
    content: trimmed,
    phaseId: state.currentPhaseId,
    phaseTitle: phase.title,
    interactionType: 'user_interjection',
    targetAgentIds: [],
    createdAt: nowIso(),
  };
  return { ...state, messages: [...state.messages, message] };
}

export function requestAgentResponse(
  state: RoundtableState,
  agentId: string,
  instruction: string,
  targetAgentId?: string,
): RoundtableState {
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent || !instruction.trim()) return state;
  const target = targetAgentId ? state.agents.find((item) => item.id === targetAgentId) : null;
  const targetPrefix = target ? `@${target.name} ` : '';
  const content = `${targetPrefix}${instruction.trim()} 我会只基于自己的角色设定和私有 skill 回答。`;
  const message = createMessage(
    state,
    agent,
    state.currentPhaseId,
    content,
    target ? 'reply' : 'mention',
    target ? [target.id] : [],
  );
  return { ...state, messages: [...state.messages, message] };
}

export function getInteractionEdges(messages: RoundtableMessage[]): InteractionEdge[] {
  const edgeTypes: InteractionType[] = ['mention', 'reply', 'challenge', 'evidence_request', 'synthesis'];
  return messages.flatMap((message) => {
    if (!edgeTypes.includes(message.interactionType)) return [];
    return message.targetAgentIds.map((targetId) => ({
      id: `${message.id}-${targetId}`,
      sourceAgentId: message.senderId,
      targetAgentId: targetId,
      type: message.interactionType,
      phaseId: message.phaseId,
    }));
  });
}

function formatFactStatus(entry: Pick<FactPackEntry, 'status' | 'source'>): string {
  if (entry.status === 'verified') return entry.source ? `已验证，来源：${entry.source}` : '已验证';
  if (entry.status === 'needs_evidence') return '需要证据';
  return factStatusLabels[entry.status];
}

export function exportRoundtableMarkdown(state: RoundtableState): string {
  const selectedAgents = getSelectedAgents(state);
  const finalOutput = state.finalOutput || buildFinalOutput(state);
  const roundSummary = ROUNDTABLE_PHASES.map((phase) => {
    const count = state.messages.filter((message) => message.phaseId === phase.id).length;
    return `- ${phase.title}：${count} 条可见消息`;
  }).join('\n');

  const factSummary = state.factPack.length
    ? state.factPack.map((entry) =>
      `- [${formatFactStatus(entry)}] ${factTypeLabels[entry.type]}：${entry.content}`
    ).join('\n')
    : '- 暂无事实包条目。';

  const ideaSections = finalOutput.ideas.map((idea) => [
    `### ${idea.title}`,
    '',
    '支持理由',
    ...idea.supportingReasons.map((item) => `- ${item}`),
    '',
    '反对意见',
    ...idea.objections.map((item) => `- ${item}`),
    '',
    '关键风险',
    ...idea.keyRisks.map((item) => `- ${item}`),
  ].join('\n')).join('\n\n');

  return [
    '# 圆桌讨论最终输出',
    '',
    `讨论议题：${state.topic || '未设置'}`,
    `会议目标：${state.objective || '未设置'}`,
    '',
    '## 已选 Agent',
    selectedAgents.length
      ? selectedAgents.map((agent) => `- ${agent.name}: ${agent.roleLabel}`).join('\n')
      : '- 暂无已选 Agent。',
    '',
    '## 事实包摘要',
    factSummary,
    '',
    '## 轮次摘要',
    roundSummary,
    '',
    '## 候选想法',
    ideaSections || '- 暂无生成想法。',
    '',
    '## 共识',
    ...finalOutput.consensus.map((item) => `- ${item}`),
    '',
    '## 分歧',
    ...finalOutput.disagreements.map((item) => `- ${item}`),
    '',
    '## 开放问题',
    ...finalOutput.openQuestions.map((item) => `- ${item}`),
    '',
    '## 下一步建议',
    ...finalOutput.nextSteps.map((item) => `- ${item}`),
  ].join('\n');
}
