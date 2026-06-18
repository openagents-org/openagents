import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addFactEntry,
  createEmptyRoundtableState,
  createRoundtableAgent,
  exportRoundtableMarkdown,
  getInteractionEdges,
  ROUNDTABLE_PHASES,
  type RoundtableAgent,
  type RoundtableState,
} from '../lib/roundtable-engine';
import {
  advanceRuntimeStateAfterPhase,
  applyRuntimeRoundMessage,
  createDemoRuntimeOutput,
  getRuntimeRoundPlan,
  isCliRuntime,
  normalizeRuntimeOutput,
  type RoundtableRuntimePlan,
} from '../lib/roundtable-runtime';

interface RuntimeApiResult {
  ok: boolean;
  output: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  command?: string;
  durationMs?: number;
  promptPath?: string;
  outputPath?: string;
  error?: string;
}

const appUrl = process.env.ROUNDTABLE_SELF_TEST_URL || 'http://localhost:3001';
const artifactDir = join(process.cwd(), '..', '..', 'output', 'roundtable-product-path');
mkdirSync(artifactDir, { recursive: true });

const topic = 'Should Pfizer China HBU explore a bold AI-enabled commercial strategy for anti-infective, ICU, respiratory, and hematology-related opportunities in the next 1-2 years?';
const objective = 'Generate bolder commercial strategy hypotheses, challenge them from different business-thinking perspectives, and produce supporting reasons, objections, key risks, consensus, disagreements, and open validation questions.';
const markers = [
  'ALPHA_CODEX_SKILL_ACTIVE_ONLY',
  'BETA_CODEX_SKILL_ACTIVE_ONLY',
  'GAMMA_CODEX_SKILL_ACTIVE_ONLY',
  'DELTA_CLAUDE_SKILL_ACTIVE_ONLY',
  'EPSILON_CLAUDE_SKILL_ACTIVE_ONLY',
  'CHAIR_SKILL_ACTIVE_ONLY',
];

function writeArtifact(name: string, value: string): string {
  const filePath = join(artifactDir, name);
  writeFileSync(filePath, value, 'utf8');
  return filePath;
}

function createAgents(): RoundtableAgent[] {
  return [
    createRoundtableAgent({
      id: 'alpha-codex',
      name: 'Alpha-Codex',
      avatar: 'A1',
      roleLabel: '第一性原理挑战者',
      roleDescription: '用第一性原理挑战惯性增长、资源假设和边界条件。',
      responsibility: '提出最大胆但可证伪的策略假设，并指出最关键的验证证据。',
      skillContent: '# Private Skill\nALPHA_CODEX_SKILL_ACTIVE_ONLY\n只从第一性原理和可证伪假设出发。',
      runtime: 'codex_cli',
      agentKind: 'public_figure',
      participationMode: 'participant',
      skillId: 'alpha-codex-skill',
      skillSourcePath: 'roundtable-skills/alpha-codex/SKILL.md',
      skillLoadStatus: 'verified_loaded',
    }),
    createRoundtableAgent({
      id: 'beta-codex',
      name: 'Beta-Codex',
      avatar: 'B2',
      roleLabel: '客户飞轮策略师',
      roleDescription: '从客户价值、医院采用路径和增长飞轮审视商业策略。',
      responsibility: '判断策略是否能形成可复用客户价值和商业飞轮。',
      skillContent: '# Private Skill\nBETA_CODEX_SKILL_ACTIVE_ONLY\n只从客户/flywheel 策略视角发言。',
      runtime: 'codex_cli',
      agentKind: 'public_figure',
      participationMode: 'participant',
      skillId: 'beta-codex-skill',
      skillSourcePath: 'roundtable-skills/beta-codex/SKILL.md',
      skillLoadStatus: 'verified_loaded',
    }),
    createRoundtableAgent({
      id: 'gamma-codex',
      name: 'Gamma-Codex',
      avatar: 'G3',
      roleLabel: '逆向策略批判者',
      roleDescription: '寻找反例、约束和被过度乐观忽略的失败路径。',
      responsibility: '提出反对意见、失败模式和必须先验证的薄弱假设。',
      skillContent: '# Private Skill\nGAMMA_CODEX_SKILL_ACTIVE_ONLY\n只做逆向策略批判，不追随共识。',
      runtime: 'codex_cli',
      agentKind: 'public_figure',
      participationMode: 'participant',
      skillId: 'gamma-codex-skill',
      skillSourcePath: 'roundtable-skills/gamma-codex/SKILL.md',
      skillLoadStatus: 'verified_loaded',
    }),
    createRoundtableAgent({
      id: 'delta-claude',
      name: 'Delta-Claude',
      avatar: 'D4',
      roleLabel: '产品叙事策略师',
      roleDescription: '把策略假设翻译成可被业务团队理解和传播的产品叙事。',
      responsibility: '检查叙事是否能解释对象、场景、价值和证据边界。',
      skillContent: '# Private Skill\nDELTA_CLAUDE_SKILL_ACTIVE_ONLY\n只从产品叙事和内部对齐角度发言。',
      runtime: 'claude_code_cli',
      agentKind: 'public_figure',
      participationMode: 'participant',
      skillId: 'delta-claude-skill',
      skillSourcePath: 'roundtable-skills/delta-claude/SKILL.md',
      skillLoadStatus: 'verified_loaded',
    }),
    createRoundtableAgent({
      id: 'epsilon-claude',
      name: 'Epsilon-Claude',
      avatar: 'E5',
      roleLabel: '执行渠道运营者',
      roleDescription: '关注医院准入、渠道执行、代表动作和落地节奏。',
      responsibility: '把大胆想法拆成渠道、试点、约束和执行风险。',
      skillContent: '# Private Skill\nEPSILON_CLAUDE_SKILL_ACTIVE_ONLY\n只从执行/渠道运营角度发言。',
      runtime: 'claude_code_cli',
      agentKind: 'public_figure',
      participationMode: 'participant',
      skillId: 'epsilon-claude-skill',
      skillSourcePath: 'roundtable-skills/epsilon-claude/SKILL.md',
      skillLoadStatus: 'verified_loaded',
    }),
    createRoundtableAgent({
      id: 'chair',
      name: 'Chair',
      avatar: 'C6',
      roleLabel: '主持人与收敛者',
      roleDescription: '控制多轮讨论协议，收敛共识、分歧、风险和验证问题。',
      responsibility: '维护事实边界，输出最终结构化总结。',
      skillContent: '# Private Skill\nCHAIR_SKILL_ACTIVE_ONLY\n只做主持、归纳和事实边界管理。',
      runtime: 'demo',
      agentKind: 'chair',
      participationMode: 'chair',
      skillId: 'chair-skill',
      skillSourcePath: 'roundtable-skills/roundtable-chair/SKILL.md',
      skillLoadStatus: 'installed',
    }),
  ];
}

function createState(): RoundtableState {
  const agents = createAgents();
  let state = createEmptyRoundtableState();
  state = {
    ...state,
    topic,
    objective,
    background: 'Pfizer China HBU 内部策略圆桌测试。讨论范围包括 anti-infective / ICU / respiratory / hematology-related opportunities。',
    searchScope: '仅使用本测试 Fact Pack；不联网检索，不伪造来源。',
    agents,
    selectedAgentIds: agents.map((agent) => agent.id),
    currentPhaseId: 'round1',
    status: 'idle',
    factPack: [],
    messages: [],
    finalOutput: null,
  };
  state = addFactEntry(state, {
    type: 'known_fact',
    content: 'HBU discussion scope includes anti-infective / ICU / respiratory / hematology-related opportunities.',
    source: 'user-provided test context',
    status: 'verified',
    addedBy: 'product-path-test',
  });
  state = addFactEntry(state, {
    type: 'uncertainty',
    content: 'AI-enabled commercial workflows may improve strategic option generation and meeting quality.',
    source: '',
    status: 'unverified',
    addedBy: 'product-path-test',
  });
  state = addFactEntry(state, {
    type: 'evidence_request',
    content: 'Need evidence on policy, hospital adoption, and field execution constraints.',
    source: '',
    status: 'needs_evidence',
    addedBy: 'product-path-test',
  });
  return state;
}

function assertRoleAgentContext(state: RoundtableState) {
  const checks = getRuntimeRoundPlan(state).map((plan) => {
    const leakedMarkers = markers.filter((marker) => plan.prompt.includes(marker));
    return {
      agentName: plan.agentName,
      runtime: plan.runtime,
      hasSkillId: plan.prompt.includes('Skill ID:'),
      hasLoadStatus: plan.prompt.includes('Skill load status:'),
      leakedMarkers,
      pass: plan.prompt.includes('Skill ID:') &&
        plan.prompt.includes('Skill load status:') &&
        leakedMarkers.length === 0,
    };
  });
  assert.equal(checks.every((check) => check.pass), true);
  return checks;
}

async function callRuntime(plan: RoundtableRuntimePlan): Promise<RuntimeApiResult> {
  const response = await fetch(`${appUrl}/api/roundtable/runtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runtime: plan.runtime,
      prompt: plan.prompt,
      agentName: plan.agentName,
      phaseId: plan.phaseId,
      timeoutMs: 180_000,
    }),
  });
  const payload = await response.json().catch(() => null) as RuntimeApiResult | null;
  if (!payload) {
    return { ok: false, output: '', error: `non-json response ${response.status}` };
  }
  return payload;
}

async function runPhase(state: RoundtableState, calls: Array<RuntimeApiResult & { agentName: string; runtime: string; phaseId: string }>) {
  const initialPlan = getRuntimeRoundPlan(state);
  let workingState: RoundtableState = { ...state, status: 'running' };
  for (const initialItem of initialPlan) {
    const plan = getRuntimeRoundPlan(workingState).find((item) => item.agentId === initialItem.agentId) || initialItem;
    if (!isCliRuntime(plan.runtime)) {
      workingState = applyRuntimeRoundMessage(workingState, plan, createDemoRuntimeOutput(plan), { runtime: 'demo' });
      continue;
    }
    const result = await callRuntime(plan);
    calls.push({ ...result, agentName: plan.agentName, runtime: plan.runtime, phaseId: plan.phaseId });
    assert.equal(result.ok, true, `${plan.agentName} ${plan.runtime} failed: ${result.error || result.stderr}`);
    const normalized = normalizeRuntimeOutput(result.output, plan, workingState);
    workingState = applyRuntimeRoundMessage(workingState, plan, normalized, {
      runtime: plan.runtime,
      durationMs: result.durationMs,
    });
  }
  return advanceRuntimeStateAfterPhase(workingState);
}

async function main() {
  let state = createState();
  const roleAgentContextChecks = assertRoleAgentContext(state);
  const calls: Array<RuntimeApiResult & { agentName: string; runtime: string; phaseId: string }> = [];

  for (const phase of ROUNDTABLE_PHASES.map((item) => item.id)) {
    assert.equal(state.currentPhaseId, phase);
    state = await runPhase(state, calls);
  }

  const markdown = exportRoundtableMarkdown(state);
  const statePath = writeArtifact('roundtable-product-path-state.json', JSON.stringify(state, null, 2));
  const callsPath = writeArtifact('roundtable-product-path-calls.json', JSON.stringify(calls, null, 2));
  const markdownPath = writeArtifact('roundtable-product-path-final-output.md', markdown);
  const edges = getInteractionEdges(state.messages);
  const leakedMarkersInMessages = markers.filter((marker) => state.messages.some((message) => message.content.includes(marker)));

  const summary = {
    status: 'pass',
    appUrl,
    chairRuntime: 'demo/app logic',
    agents: state.agents.map((agent) => ({
      name: agent.name,
      runtime: agent.runtime,
      avatar: agent.avatar,
      roleLabel: agent.roleLabel,
    })),
    counts: {
      messages: state.messages.length,
      realRuntimeMessages: calls.filter((call) => call.ok).length,
      codexMessages: calls.filter((call) => call.runtime === 'codex_cli' && call.ok).length,
      claudeMessages: calls.filter((call) => call.runtime === 'claude_code_cli' && call.ok).length,
      challengeMessages: state.messages.filter((message) => message.interactionType === 'challenge').length,
      replyMessages: state.messages.filter((message) => message.interactionType === 'reply').length,
      evidenceRequestMessages: state.messages.filter((message) => message.interactionType === 'evidence_request').length,
      edges: edges.length,
      factPackEntries: state.factPack.length,
    },
    roleAgentContextChecks,
    leakedMarkersInMessages,
    artifacts: {
      artifactDir,
      statePath,
      callsPath,
      markdownPath,
    },
  };

  assert.equal(state.status, 'complete');
  assert.ok(state.finalOutput);
  assert.ok(summary.counts.realRuntimeMessages >= 5);
  assert.ok(summary.counts.codexMessages >= 1);
  assert.ok(summary.counts.claudeMessages >= 1);
  assert.ok(summary.counts.challengeMessages >= 2);
  assert.ok(summary.counts.replyMessages >= 2);
  assert.ok(summary.counts.evidenceRequestMessages >= 1);
  assert.ok(summary.counts.edges >= 1);
  assert.deepEqual(leakedMarkersInMessages, []);
  assert.ok(markdown.includes('讨论议题'));
  assert.ok(markdown.includes('会议目标'));
  assert.ok(markdown.includes('事实包摘要'));
  assert.ok(markdown.includes('共识'));
  assert.ok(markdown.includes('分歧'));
  assert.ok(markdown.includes('开放问题'));

  const summaryPath = writeArtifact('roundtable-product-path-summary.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, artifacts: { ...summary.artifacts, summaryPath } }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
