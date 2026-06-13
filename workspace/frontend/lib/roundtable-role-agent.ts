import {
  ROUNDTABLE_PHASES,
  type FactEntryStatus,
  type FactEntryType,
  type InteractionType,
  type RoundtableAgent,
  type RoundtablePhaseId,
  type RoundtableState,
} from './roundtable-engine';

export type AgentSkillMode =
  | 'verified_role_agent'
  | 'installed_unverified'
  | 'draft_role_agent'
  | 'background_agent'
  | 'legacy_prompt';

export interface RoleAgentDescriptor {
  id: string;
  name: string;
  agentKind: RoundtableAgent['agentKind'];
  participationMode: RoundtableAgent['participationMode'];
  runtime: RoundtableAgent['runtime'];
  skillId?: string;
  skillSourcePath?: string;
  skillLoadStatus: RoundtableAgent['skillLoadStatus'];
  corpusPath?: string;
  sourceManifestPath?: string;
  qualityScores?: RoundtableAgent['qualityScores'];
}

export interface RoleAgentPromptInput {
  state: RoundtableState;
  agent: RoundtableAgent;
  phaseId: RoundtablePhaseId;
  interactionType: InteractionType;
  targetAgentNames: string[];
  instruction: string;
}

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

export function isBackgroundOnlyAgent(agent: RoundtableAgent): boolean {
  return agent.participationMode === 'background_research' || agent.participationMode === 'judge';
}

export function getAgentSkillMode(agent: RoundtableAgent): AgentSkillMode {
  if (isBackgroundOnlyAgent(agent)) return 'background_agent';
  if (agent.skillLoadStatus === 'verified_loaded') return 'verified_role_agent';
  if (agent.skillLoadStatus === 'installed') return 'installed_unverified';
  if (agent.skillLoadStatus === 'draft_skill' || agent.skillLoadStatus === 'load_failed') return 'draft_role_agent';
  return 'legacy_prompt';
}

export function toRoleAgentDescriptor(agent: RoundtableAgent): RoleAgentDescriptor {
  return {
    id: agent.id,
    name: agent.name,
    agentKind: agent.agentKind,
    participationMode: agent.participationMode,
    runtime: agent.runtime,
    skillId: agent.skillId,
    skillSourcePath: agent.skillSourcePath,
    skillLoadStatus: agent.skillLoadStatus,
    corpusPath: agent.corpusPath,
    sourceManifestPath: agent.sourceManifestPath,
    qualityScores: agent.qualityScores,
  };
}

function phaseTitle(phaseId: RoundtablePhaseId): string {
  return ROUNDTABLE_PHASES.find((phase) => phase.id === phaseId)?.title || phaseId;
}

function formatFactPack(state: RoundtableState): string {
  if (!state.factPack.length) return '- 事实包暂无条目。';
  return state.factPack.map((entry) =>
    `- [${factStatusLabels[entry.status]}] ${factTypeLabels[entry.type]}：${entry.content}${entry.source ? ` 来源：${entry.source}` : ' 来源：无'}`
  ).join('\n');
}

function formatTranscript(state: RoundtableState): string {
  if (!state.messages.length) return '- 暂无公开群聊记录。';
  return state.messages.map((message) =>
    `- ${message.phaseTitle} / ${message.senderName} / ${message.interactionType}：${message.content}`
  ).join('\n');
}

export function buildRoleAgentTaskPrompt(input: RoleAgentPromptInput): string {
  const { state, agent, phaseId, interactionType, targetAgentNames, instruction } = input;
  return [
    `你是 ${agent.name}。`,
    `角色标签：${agent.roleLabel}`,
    `角色描述：${agent.roleDescription}`,
    `会议职责：${agent.responsibility}`,
    `Agent kind: ${agent.agentKind}`,
    `Participation mode: ${agent.participationMode}`,
    `Skill ID: ${agent.skillId || 'none'}`,
    `Skill path: ${agent.skillSourcePath || 'none'}`,
    `Skill load status: ${agent.skillLoadStatus}`,
    '',
    'Role Agent 运行约束：',
    '- 你应使用运行环境中已经加载的 Skill；本 prompt 不包含完整 Skill 正文。',
    '- 不要说“我以某某视角”“非本人观点”“目标对象：”“作为 AI”等面具感语言。',
    '- 没有足够证据时，只能给已知事实、候选假设、验证路径或临时止血方案。',
    '- 直接做判断、追问、反驳、修正和收敛，不解释 persona。',
    '',
    `讨论议题：${state.topic || '未设置'}`,
    `会议目标：${state.objective || '未设置'}`,
    `背景材料：${state.background || '无'}`,
    `当前阶段：${phaseTitle(phaseId)}`,
    `互动意图：${interactionType}`,
    `需要回应或追问的人：${targetAgentNames.length ? targetAgentNames.join('、') : '无指定对象'}`,
    '',
    '本轮任务：',
    instruction,
    '',
    '事实包：',
    formatFactPack(state),
    '',
    '公开群聊记录：',
    formatTranscript(state),
  ].join('\n');
}
