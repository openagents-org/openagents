import {
  ROUNDTABLE_PHASES,
  addFactEntry,
  buildAgentGenerationContext,
  buildFinalOutput,
  getSelectedAgents,
  renderAgentPrompt,
  type InteractionType,
  type RoundtableAgent,
  type RoundtableAgentRuntime,
  type RoundtableMessage,
  type RoundtablePhaseId,
  type RoundtableState,
} from './roundtable-engine';
import { buildRoleAgentTaskPrompt, getAgentSkillMode } from './roundtable-role-agent';

export interface RoundtableRuntimePlan {
  id: string;
  agentId: string;
  agentName: string;
  runtime: RoundtableAgentRuntime;
  phaseId: RoundtablePhaseId;
  phaseTitle: string;
  interactionType: InteractionType;
  targetAgentIds: string[];
  targetAgentNames: string[];
  prompt: string;
}

export interface NormalizedRuntimeOutput {
  content: string;
  interactionType: InteractionType;
  targetAgentIds: string[];
  relatedIdea?: string;
  evidenceRequest?: string;
}

export interface RuntimeMessageMeta {
  runtime?: RoundtableAgentRuntime;
  durationMs?: number;
}

export const runtimeLabels: Record<RoundtableAgentRuntime, string> = {
  demo: 'Demo 确定性',
  codex_cli: 'Codex CLI',
  claude_code_cli: 'Claude Code CLI',
};

const structuredInteractions: InteractionType[] = [
  'statement',
  'mention',
  'reply',
  'challenge',
  'evidence_request',
  'synthesis',
];

function phaseById(phaseId: RoundtablePhaseId) {
  return ROUNDTABLE_PHASES.find((phase) => phase.id === phaseId) || ROUNDTABLE_PHASES[0];
}

function nextPhaseId(phaseId: RoundtablePhaseId): RoundtablePhaseId {
  const index = ROUNDTABLE_PHASES.findIndex((phase) => phase.id === phaseId);
  return ROUNDTABLE_PHASES[index + 1]?.id || ROUNDTABLE_PHASES.at(-1)?.id || 'round7';
}

function targetForAgent(agents: RoundtableAgent[], index: number): RoundtableAgent | null {
  if (agents.length < 2) return null;
  return agents[(index + 1) % agents.length];
}

function previousForAgent(agents: RoundtableAgent[], index: number): RoundtableAgent | null {
  if (agents.length < 2) return null;
  return agents[(index - 1 + agents.length) % agents.length];
}

function chooseSynthesizer(agents: RoundtableAgent[]): RoundtableAgent | null {
  return agents.find((agent) => /chair|synth|summary|consensus|主持|收敛|总结|共识/i.test(
    `${agent.name} ${agent.roleLabel} ${agent.responsibility}`
  )) || agents[0] || null;
}

function planInteraction(phaseId: RoundtablePhaseId, agents: RoundtableAgent[], index: number) {
  const agent = agents[index];
  if (phaseId === 'round1') {
    return { interactionType: 'statement' as InteractionType, targets: [] as RoundtableAgent[] };
  }
  if (phaseId === 'round2') {
    const target = targetForAgent(agents, index);
    if (!target) return { interactionType: 'challenge' as InteractionType, targets: [] as RoundtableAgent[] };
    return {
      interactionType: index === 0 ? 'evidence_request' as InteractionType : 'challenge' as InteractionType,
      targets: [target],
    };
  }
  if (phaseId === 'round3') {
    const target = previousForAgent(agents, index);
    return { interactionType: 'reply' as InteractionType, targets: target ? [target] : [] };
  }
  if (phaseId === 'round4') {
    const target = targetForAgent(agents, index + 1);
    return { interactionType: 'evidence_request' as InteractionType, targets: target ? [target] : [] };
  }
  if (phaseId === 'round5') {
    const target = previousForAgent(agents, index);
    return { interactionType: 'challenge' as InteractionType, targets: target ? [target] : [] };
  }
  if (phaseId === 'round6') {
    const target = targetForAgent(agents, index);
    return { interactionType: 'reply' as InteractionType, targets: target ? [target] : [] };
  }
  return {
    interactionType: 'synthesis' as InteractionType,
    targets: agents.filter((item) => item.id !== agent.id),
  };
}

function instructionForPlan(
  phaseId: RoundtablePhaseId,
  interactionType: InteractionType,
  targetAgentNames: string[],
): string {
  const targetText = targetAgentNames.length ? targetAgentNames.join('、') : '无指定对象';
  const base = [
    '请只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出解释性前后缀。',
    'JSON schema: {"content":"中文发言正文","interactionType":"statement|mention|reply|challenge|evidence_request|synthesis","targetAgentNames":["目标 Agent 名称"],"relatedIdea":"可选","evidenceRequest":"可选"}',
    'content 用中文，控制在 180-360 字；像会议现场发言，不像报告摘要。',
    '不要复述、泄露或输出任何 *_SKILL_ACTIVE_ONLY 标识。',
    '不要在 content 中说“我以某某视角”“非本人观点”“目标对象：”“当前判断：”“依据 / 来源：”“未证实部分：”等协议或模板标签。',
    '不要使用“你的挑战成立”“我接受你的挑战”这类 AI 协作套话；要么直接反驳，要么直接修正主张。',
    '如果需要点名，直接用“彼得，你这里的问题是……”这类自然会议语言。',
    '没有来源的判断必须标注“未证实”或“需要证据”。',
    `本轮互动意图：${interactionType}。需要回应或追问的人：${targetText}。这个信息只用于组织发言，不要照抄成标签。`,
  ];
  if (phaseId === 'round1') {
    base.push('第 1 轮：像 CEO 圆桌开场一样给出明确赌注，包含支持理由、关键风险和开放验证问题。');
  } else if (phaseId === 'round2') {
    base.push('第 2 轮：正面挑战对方最薄弱的假设，语气要直接，但不要人身化。');
  } else if (phaseId === 'round3') {
    base.push('第 3 轮：回应上一轮挑战。不要说“挑战成立”，直接说你改掉什么、坚持什么。');
  } else if (phaseId === 'round4') {
    base.push('第 4 轮：证据深挖。逼近指标、样本、时间窗口、责任人、失败判据和合规边界。');
  } else if (phaseId === 'round5') {
    base.push('第 5 轮：取舍谈判。说清楚砍掉什么、加码什么、谁承担代价。');
  } else if (phaseId === 'round6') {
    base.push('第 6 轮：最终立场。给出支持、反对或有条件支持，并给一个硬验证指标。');
  } else {
    base.push('第 7 轮：收敛总结。不要套模板，要把真实冲突、最强结论和下一步决策写出来。');
  }
  return base.join('\n');
}

function buildPrompt(
  state: RoundtableState,
  agent: RoundtableAgent,
  phaseId: RoundtablePhaseId,
  interactionType: InteractionType,
  targetAgentNames: string[],
  instruction: string,
): string {
  if (getAgentSkillMode(agent) === 'legacy_prompt') {
    return [
      renderAgentPrompt(buildAgentGenerationContext(state, agent.id, phaseId)),
      '',
      'Runtime 输出要求：',
      instruction,
    ].join('\n');
  }
  return buildRoleAgentTaskPrompt({
    state,
    agent,
    phaseId,
    interactionType,
    targetAgentNames,
    instruction,
  });
}

export function isCliRuntime(runtime: RoundtableAgentRuntime): boolean {
  return runtime === 'codex_cli' || runtime === 'claude_code_cli';
}

export function getRuntimeRoundPlan(state: RoundtableState): RoundtableRuntimePlan[] {
  const selectedAgents = getSelectedAgents(state).filter((agent) =>
    agent.participationMode !== 'background_research' && agent.participationMode !== 'judge'
  );
  const phaseId = state.currentPhaseId;
  const phase = phaseById(phaseId);
  const finalPhaseId = ROUNDTABLE_PHASES.at(-1)?.id || 'round7';
  const plannedAgents = phaseId === finalPhaseId
    ? selectedAgents.filter((agent) => agent.id === chooseSynthesizer(selectedAgents)?.id)
    : selectedAgents;

  return plannedAgents.map((agent) => {
    const originalIndex = selectedAgents.findIndex((item) => item.id === agent.id);
    const interaction = planInteraction(phaseId, selectedAgents, originalIndex);
    const targetAgentIds = interaction.targets.map((target) => target.id);
    const targetAgentNames = interaction.targets.map((target) => target.name);
    const instruction = instructionForPlan(phaseId, interaction.interactionType, targetAgentNames);
    return {
      id: `${phaseId}:${agent.id}`,
      agentId: agent.id,
      agentName: agent.name,
      runtime: agent.runtime,
      phaseId,
      phaseTitle: phase.title,
      interactionType: interaction.interactionType,
      targetAgentIds,
      targetAgentNames,
      prompt: buildPrompt(state, agent, phaseId, interaction.interactionType, targetAgentNames, instruction),
    };
  });
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {}
  }
  return null;
}

function scrubPrivateMarkers(value: string): string {
  return value.replace(/\b[A-Z0-9]+(?:_[A-Z0-9]+)*_SKILL_ACTIVE_ONLY\b/g, '[已隐藏私有 skill 标识]');
}

function scrubProtocolLanguage(value: string): string {
  return scrubPrivateMarkers(value)
    .replace(/^\s*我以[^\n。！？]*(?:视角|身份)[^\n。！？]*(?:非本人观点|公开材料推断)[。！？]?\s*/gm, '')
    .replace(/^\s*(?:目标对象|发言类型|当前判断|依据\s*\/\s*来源|未证实部分)\s*[:：][^\n]*(?:\n|$)/gm, '')
    .replace(/你的挑战成立/g, '这个问题说到关键处')
    .replace(/我接受你的挑战/g, '我会收窄判断')
    .replace(/我接受上一轮挑战/g, '上一轮问题说到关键处')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInteraction(value: unknown, fallback: InteractionType): InteractionType {
  if (typeof value !== 'string') return fallback;
  return structuredInteractions.includes(value as InteractionType) ? value as InteractionType : fallback;
}

function namesFromParsed(parsed: Record<string, unknown> | null): string[] {
  if (!parsed) return [];
  const direct = parsed.targetAgentNames || parsed.targets || parsed.targetAgents || parsed.targetAgentName;
  if (Array.isArray(direct)) return direct.filter((item): item is string => typeof item === 'string');
  return typeof direct === 'string' ? [direct] : [];
}

function idsForNames(names: string[], state: RoundtableState): string[] {
  const normalized = names.map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return [];
  return state.agents
    .filter((agent) => normalized.some((name) =>
      agent.name.toLowerCase() === name ||
      agent.name.toLowerCase().includes(name) ||
      name.includes(agent.name.toLowerCase())
    ))
    .map((agent) => agent.id);
}

export function normalizeRuntimeOutput(
  rawOutput: string,
  plan: RoundtableRuntimePlan,
  state: RoundtableState,
): NormalizedRuntimeOutput {
  const parsed = parseJsonObject(rawOutput);
  const parsedContent = typeof parsed?.content === 'string' ? parsed.content : rawOutput;
  const targetIds = idsForNames(namesFromParsed(parsed), state);
  const evidenceRequest = typeof parsed?.evidenceRequest === 'string' ? parsed.evidenceRequest : undefined;
  const relatedIdea = typeof parsed?.relatedIdea === 'string' ? parsed.relatedIdea : undefined;
  const content = scrubProtocolLanguage(parsedContent.trim() || 'Runtime 未返回可展示内容。')
    || 'Runtime 未返回可展示内容。';
  const interactionType = normalizeInteraction(parsed?.interactionType, plan.interactionType);

  return {
    content,
    interactionType,
    targetAgentIds: targetIds.length ? targetIds : plan.targetAgentIds,
    relatedIdea,
    evidenceRequest: evidenceRequest || (interactionType === 'evidence_request' ? content : undefined),
  };
}

export function createDemoRuntimeOutput(plan: RoundtableRuntimePlan): NormalizedRuntimeOutput {
  const targetText = plan.targetAgentNames.length ? `@${plan.targetAgentNames.join('、')} ` : '';
  const contentByType: Record<InteractionType, string> = {
    statement: '这件事值得往前推，但先别扩大战线。支持理由、执行边界和验证问题必须放在同一张桌面上，否则大胆想法很快会变成口号。',
    mention: `${targetText}我想补充一个相关视角：先明确目标客户和证据边界，再讨论资源投入。`,
    reply: `${targetText}上一轮问题说到关键处，我会把主张收窄：先做小范围验证，再根据事实包决定是否扩大投入。`,
    challenge: `${targetText}这个假设现在太轻。如果没有医院采用、政策约束和现场执行证据，它仍属于未证实判断。`,
    evidence_request: `${targetText}先把政策边界、医院采用意愿、执行约束和样本来源补齐；没有这些，讨论不能进入承诺。`,
    synthesis: '我先收束：保留可快速验证的大胆假设，把反对意见、关键风险和下一步证据请求留在台面上。',
    user_interjection: '用户插话',
  };
  return {
    content: contentByType[plan.interactionType],
    interactionType: plan.interactionType,
    targetAgentIds: plan.targetAgentIds,
    evidenceRequest: plan.interactionType === 'evidence_request' ? contentByType.evidence_request : undefined,
  };
}

export function applyRuntimeRoundMessage(
  state: RoundtableState,
  plan: RoundtableRuntimePlan,
  output: NormalizedRuntimeOutput,
  meta: RuntimeMessageMeta = {},
): RoundtableState {
  const agent = state.agents.find((item) => item.id === plan.agentId);
  if (!agent) return state;
  const phase = phaseById(plan.phaseId);
  const runtimeSuffix = meta.runtime && meta.runtime !== 'demo'
    ? `\n\n[Runtime: ${runtimeLabels[meta.runtime]}${meta.durationMs ? `, ${Math.round(meta.durationMs / 1000)}s` : ''}]`
    : '';
  const message: RoundtableMessage = {
    id: `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    senderId: agent.id,
    senderName: agent.name,
    senderAvatar: agent.avatar,
    senderRoleLabel: agent.roleLabel,
    content: `${output.content}${runtimeSuffix}`,
    phaseId: plan.phaseId,
    phaseTitle: phase.title,
    interactionType: output.interactionType,
    targetAgentIds: output.targetAgentIds,
    relatedIdea: output.relatedIdea,
    evidenceRequest: output.evidenceRequest,
    createdAt: new Date().toISOString(),
  };
  const nextState = { ...state, status: 'running' as const, messages: [...state.messages, message] };
  if (output.interactionType !== 'evidence_request' || !output.evidenceRequest) return nextState;
  return addFactEntry(nextState, {
    type: 'evidence_request',
    content: output.evidenceRequest,
    source: '',
    status: 'needs_evidence',
    addedBy: agent.name,
    phaseId: plan.phaseId,
  });
}

export function advanceRuntimeStateAfterPhase(state: RoundtableState): RoundtableState {
  const phaseId = state.currentPhaseId;
  const finalPhaseId = ROUNDTABLE_PHASES.at(-1)?.id || 'round7';
  if (phaseId === finalPhaseId) {
    const completeState = {
      ...state,
      status: 'complete' as const,
      currentPhaseId: finalPhaseId,
      pendingExtraRoundSuggestion: '如果事实包改变了领先想法，Agent 建议可追加一轮跟进讨论，需要用户确认。',
    };
    return { ...completeState, finalOutput: buildFinalOutput(completeState) };
  }
  return {
    ...state,
    status: 'running' as const,
    currentPhaseId: nextPhaseId(phaseId),
  };
}
