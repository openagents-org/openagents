import assert from 'node:assert/strict';
import {
  addFactEntry,
  createEmptyRoundtableState,
  createRoundtableAgent,
  type RoundtableState,
} from '../lib/roundtable-engine';
import {
  applyRuntimeRoundMessage,
  getRuntimeRoundPlan,
  normalizeRuntimeOutput,
} from '../lib/roundtable-runtime';

const markers = [
  'ALPHA_CODEX_SKILL_ACTIVE_ONLY',
  'BETA_CLAUDE_SKILL_ACTIVE_ONLY',
  'CHAIR_SKILL_ACTIVE_ONLY',
];

function createState(): RoundtableState {
  const alpha = createRoundtableAgent({
    id: 'alpha',
    name: 'Alpha-Codex',
    avatar: 'A',
    roleLabel: '第一性原理挑战者',
    roleDescription: '只从第一性原理挑战策略假设。',
    responsibility: '提出大胆假设并说明证据边界。',
    skillContent: `# Alpha Skill\n${markers[0]}`,
    runtime: 'codex_cli',
    agentKind: 'public_figure',
    participationMode: 'participant',
    skillId: 'alpha-skill',
    skillSourcePath: 'roundtable-skills/alpha/SKILL.md',
    skillLoadStatus: 'verified_loaded',
  });
  const beta = createRoundtableAgent({
    id: 'beta',
    name: 'Beta-Claude',
    avatar: 'B',
    roleLabel: '客户飞轮策略师',
    roleDescription: '只从客户价值和增长飞轮审视策略。',
    responsibility: '挑战客户采用和商业闭环。',
    skillContent: `# Beta Skill\n${markers[1]}`,
    runtime: 'claude_code_cli',
    agentKind: 'public_figure',
    participationMode: 'participant',
    skillId: 'beta-skill',
    skillSourcePath: 'roundtable-skills/beta/SKILL.md',
    skillLoadStatus: 'verified_loaded',
  });
  const chair = createRoundtableAgent({
    id: 'chair',
    name: 'Chair',
    avatar: 'C',
    roleLabel: '主持人',
    roleDescription: '负责收敛共识和分歧。',
    responsibility: '形成最终结构化输出。',
    skillContent: `# Chair Skill\n${markers[2]}`,
    runtime: 'codex_cli',
    agentKind: 'chair',
    participationMode: 'chair',
    skillId: 'chair-skill',
    skillSourcePath: 'roundtable-skills/chair/SKILL.md',
    skillLoadStatus: 'installed',
  });

  let state = createEmptyRoundtableState();
  state = {
    ...state,
    topic: 'Pfizer China HBU AI commercial strategy',
    objective: 'Generate bold hypotheses and validation questions.',
    background: 'P0 runtime contract test.',
    searchScope: 'Only manual Fact Pack.',
    agents: [alpha, beta, chair],
    selectedAgentIds: [alpha.id, beta.id, chair.id],
    currentPhaseId: 'round1',
    messages: [],
    factPack: [],
    finalOutput: null,
    status: 'idle',
  };
  state = addFactEntry(state, {
    type: 'known_fact',
    content: 'HBU discussion scope includes anti-infective / ICU / respiratory / hematology-related opportunities.',
    source: 'user-provided test context',
    status: 'verified',
    addedBy: 'test',
  });
  return state;
}

let state = createState();
const round1Plan = getRuntimeRoundPlan(state);

assert.equal(round1Plan.length, 3);
assert.equal(round1Plan[0].runtime, 'codex_cli');
assert.equal(round1Plan[1].runtime, 'claude_code_cli');
assert.equal(round1Plan[2].runtime, 'codex_cli');
for (const plan of round1Plan) {
  assert.match(plan.prompt, /Skill ID:/, `${plan.agentName} prompt should describe skill identity`);
  assert.match(plan.prompt, /Skill load status:/, `${plan.agentName} prompt should include load status`);
  for (const marker of markers) {
    assert.doesNotMatch(plan.prompt, new RegExp(marker), `${plan.agentName} role-agent prompt leaked full skill marker ${marker}`);
  }
  assert.doesNotMatch(plan.prompt, /仅供该 Agent 使用的私有 Skill 内容/);
}

state = applyRuntimeRoundMessage(state, round1Plan[0], normalizeRuntimeOutput('Alpha message', round1Plan[0], state));
state = applyRuntimeRoundMessage(state, round1Plan[1], normalizeRuntimeOutput('Beta message', round1Plan[1], state));
state = { ...state, currentPhaseId: 'round2' };

const round2Plan = getRuntimeRoundPlan(state);
assert.equal(round2Plan.some((plan) => plan.interactionType === 'challenge'), true);

const challenge = normalizeRuntimeOutput(
  JSON.stringify({
    content: '@Beta-Claude 我挑战你的客户飞轮假设，需要医院采用约束证据。',
    interactionType: 'challenge',
    targetAgentNames: ['Beta-Claude'],
  }),
  round2Plan[0],
  state,
);
state = applyRuntimeRoundMessage(state, round2Plan[0], challenge);
assert.equal(state.messages.at(-1)?.interactionType, 'challenge');
assert.deepEqual(state.messages.at(-1)?.targetAgentIds, ['beta']);

const scrubbed = normalizeRuntimeOutput(
  '我以“埃隆·马斯克视角”参与，非本人观点。\n目标对象：彼得·德鲁克。\n彼得，你的挑战成立，但我会先要求算清成本下限。',
  round2Plan[0],
  state,
);
assert.doesNotMatch(scrubbed.content, /我以|非本人观点|目标对象：|你的挑战成立/);
assert.match(scrubbed.content, /彼得/);

state = { ...state, currentPhaseId: 'round4' };
const round4Plan = getRuntimeRoundPlan(state);
assert.equal(round4Plan.some((plan) => plan.interactionType === 'evidence_request'), true);

state = { ...state, currentPhaseId: 'round7' };
const round7Plan = getRuntimeRoundPlan(state);
assert.equal(round7Plan.length, 1);
assert.equal(round7Plan[0].interactionType, 'synthesis');

console.log('roundtable-runtime-product-contract-test: pass');
