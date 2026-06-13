import assert from 'node:assert/strict';
import {
  buildRoleAgentTaskPrompt,
  getAgentSkillMode,
  isBackgroundOnlyAgent,
  toRoleAgentDescriptor,
} from '../lib/roundtable-role-agent';
import {
  createEmptyRoundtableState,
  createRoundtableAgent,
  type RoundtableAgent,
} from '../lib/roundtable-engine';

const privateSkill = '# Private Skill\nSECRET_SKILL_ACTIVE_ONLY\nThis full skill must never enter role-agent task prompt.';

const roleAgent = createRoundtableAgent({
  id: 'musk',
  name: '埃隆·马斯克',
  avatar: '/roundtable/avatars/musk-real.jpg',
  roleLabel: '颠覆者',
  roleDescription: '第一性原理',
  responsibility: '挑战成本、速度和规模化假设。',
  skillContent: privateSkill,
  runtime: 'codex_cli',
  agentKind: 'public_figure',
  participationMode: 'participant',
  skillId: 'musk-first-principles-perspective',
  skillSourcePath: 'roundtable-skills/musk-first-principles-perspective/SKILL.md',
  skillLoadStatus: 'verified_loaded',
  corpusPath: 'roundtable-skills/musk-first-principles-perspective/references',
  qualityScores: {
    persona: 0.82,
    evidence: 0.74,
    intensity: 0.79,
    actionability: 0.8,
  },
} as Partial<RoundtableAgent>);

const policyAgent = createRoundtableAgent({
  id: 'policy',
  name: '政策研究 Agent',
  roleLabel: '政策研究',
  responsibility: '后台补充政策证据。',
  participationMode: 'background_research',
  agentKind: 'functional',
} as Partial<RoundtableAgent>);

let state = createEmptyRoundtableState();
state = {
  ...state,
  topic: '资源聚焦与管线补强',
  objective: '形成可验证商业决策。',
  background: '用户提供 PDF idea 摘要。',
  agents: [roleAgent, policyAgent],
  selectedAgentIds: [roleAgent.id, policyAgent.id],
  factPack: [],
  messages: [],
};

const descriptor = toRoleAgentDescriptor(roleAgent);
assert.equal(descriptor.skillLoadStatus, 'verified_loaded');
assert.equal(descriptor.skillId, 'musk-first-principles-perspective');
assert.equal(getAgentSkillMode(roleAgent), 'verified_role_agent');
assert.equal(getAgentSkillMode(policyAgent), 'background_agent');
assert.equal(isBackgroundOnlyAgent(policyAgent), true);

const prompt = buildRoleAgentTaskPrompt({
  state,
  agent: roleAgent,
  phaseId: 'round2',
  interactionType: 'challenge',
  targetAgentNames: ['彼得·德鲁克'],
  instruction: '直接挑战最薄弱假设。',
});

assert.match(prompt, /你是 埃隆·马斯克/);
assert.match(prompt, /Skill ID: musk-first-principles-perspective/);
assert.match(prompt, /Skill load status: verified_loaded/);
assert.match(prompt, /讨论议题：资源聚焦与管线补强/);
assert.doesNotMatch(prompt, /SECRET_SKILL_ACTIVE_ONLY/);
assert.doesNotMatch(prompt, /This full skill must never enter/);
assert.doesNotMatch(prompt, /仅供该 Agent 使用的私有 Skill 内容/);

console.log(JSON.stringify({ status: 'pass', skillMode: getAgentSkillMode(roleAgent) }, null, 2));
