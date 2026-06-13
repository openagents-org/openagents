# Role Agent Roundtable P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first verified Role Agent path for AgentHive roundtable so commercial leader agents are modeled, audited, and run as skill-loaded agents instead of raw `SKILL.md` prompt injections.

**Architecture:** Keep the existing P0 roundtable UI and legacy prompt path, but introduce a parallel Role Agent path with explicit skill metadata, quality gates, load-status verification, runtime command construction, and UI status badges. P1 does not regenerate all seven business-leader skills yet; it makes weak skills visible, blocks them from being called verified, and creates the tested runtime seam needed for true skill-loaded agents.

**Tech Stack:** TypeScript, Next.js 16 frontend, Node.js scripts, local `roundtable-skills`, Codex CLI / Claude Code CLI adapters, existing `npm run test:roundtable*` scripts.

---

## Scope

This is P1 of the full Role Agent design. It implements the mechanism and guardrails first:

- Audit existing `roundtable-skills`.
- Add role-agent metadata and verified/legacy/draft state.
- Stop Role Agent prompts from embedding complete `SKILL.md`.
- Make Codex runner command construction support a role-agent mode that does not force `--ignore-user-config` or `--ignore-rules`.
- Add UI status surfaces for verified, draft, and legacy.
- Update tests so they protect the new behavior.

Out of scope for P1:

- Full regeneration of Musk, Bezos, Jobs, Drucker, Grove, Thiel, and Walton skills from fresh primary-source research.
- Cloud multi-user permissions.
- Production-grade long-running agent sessions.

P1 must leave a clear next step for P2: use the audit report and Nuwa pipeline to regenerate or deeply strengthen the seven commercial leader skills.

## File Structure

Create:

- `workspace/frontend/lib/roundtable-skill-quality.ts`  
  Pure TypeScript quality gate for local skill directories. Counts research files, source manifest, source mentions, repeated protocol language, and draft/verified eligibility.

- `workspace/frontend/lib/roundtable-role-agent.ts`  
  Role Agent domain helpers: participation mode, skill status, legacy detection, role-agent prompt builder, and conversion from current `RoundtableAgent`.

- `workspace/frontend/lib/roundtable-quality-judge.ts`  
  Lightweight deterministic judge for mask language, evidence discipline, challenge intensity, actionability, and commercial sharpness.

- `workspace/frontend/scripts/roundtable-skill-quality-test.ts`  
  Node test for quality gates using temporary fixtures and current `roundtable-skills`.

- `workspace/frontend/scripts/roundtable-role-agent-contract-test.ts`  
  Node test for Role Agent metadata and prompt behavior.

- `workspace/frontend/scripts/roundtable-cli-command-contract-test.ts`  
  Node test for Codex/Claude command construction without spawning real CLIs.

Modify:

- `workspace/frontend/lib/roundtable-engine.ts`  
  Extend `RoundtableAgent` with role-agent metadata while preserving `skillContent` for legacy.

- `workspace/frontend/lib/roundtable-runtime.ts`  
  Build Role Agent task prompts for role-agent mode; keep legacy prompt builder only for legacy agents.

- `workspace/frontend/lib/roundtable-cli-runner.ts`  
  Extract pure command builders and add role-agent mode options.

- `workspace/frontend/lib/roundtable-preset-agents.ts`  
  Add metadata fields for `skillId`, `skillSourcePath`, `skillLoadStatus`, `participationMode`, and `agentKind`.

- `workspace/frontend/components/roundtable/roundtable-view.tsx`  
  Display Agent Registry status badges and legacy warnings without redesigning the whole page.

- `workspace/frontend/app/api/roundtable/runtime/route.ts`  
  Accept role-agent runtime metadata and pass it to runner.

- `workspace/frontend/package.json`  
  Add scripts for P1 tests.

## Task 1: Skill Quality Gate

**Files:**
- Create: `workspace/frontend/lib/roundtable-skill-quality.ts`
- Create: `workspace/frontend/scripts/roundtable-skill-quality-test.ts`
- Modify: `workspace/frontend/package.json`

- [ ] **Step 1: Write the failing test**

Create `workspace/frontend/scripts/roundtable-skill-quality-test.ts` with:

```ts
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessSkillDirectory,
  auditRoundtableSkills,
  compareAgenticProtocolSimilarity,
  type SkillQualityAssessment,
} from '../lib/roundtable-skill-quality';

const tmpRoot = join(process.cwd(), '.tmp-roundtable-skill-quality');
rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });

function writeSkill(id: string, body: string, researchBodies: string[], manifest = true): string {
  const dir = join(tmpRoot, id);
  mkdirSync(join(dir, 'references', 'research'), { recursive: true });
  mkdirSync(join(dir, 'references', 'sources'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8');
  researchBodies.forEach((text, index) => {
    writeFileSync(join(dir, 'references', 'research', `0${index + 1}-x.md`), text, 'utf8');
  });
  if (manifest) {
    writeFileSync(join(dir, 'references', 'sources', 'source-manifest.json'), JSON.stringify({
      sources: Array.from({ length: 10 }, (_, index) => ({
        id: `primary-${index}`,
        type: 'primary',
        title: `Primary ${index}`,
        url: `https://example.com/${index}`,
      })),
    }, null, 2), 'utf8');
  }
  return dir;
}

const repeatedProtocol = [
  '### Step 2: 研究维度',
  '- 查经典来源是否支持该角色方法，不把网络摘要当一手事实。',
  '- 查当前议题的关键约束：客户、成本、政策、证据、组织能力、时间窗口。',
  '- 标注“已证实 / 未证实 / 推断 / 需要证据”。',
].join('\n');

const strongResearch = Array.from({ length: 6 }, (_, index) =>
  `# Research ${index}\n` +
  Array.from({ length: 24 }, (__, line) => `primary excerpt ${index}-${line}: source-backed observation with specific context.`).join('\n')
);

const strongDir = writeSkill(
  'strong-leader',
  `# Strong Leader\n## Agentic Protocol\n${repeatedProtocol}\n## 核心心智模型\n一手来源 primary primary primary primary primary primary primary primary primary primary`,
  strongResearch,
);

const weakDir = writeSkill(
  'weak-leader',
  '# Weak Leader\n## Agentic Protocol\n' + repeatedProtocol,
  ['thin', 'thin', 'thin', 'thin', 'thin', 'thin'],
  false,
);

const strong = assessSkillDirectory(strongDir);
const weak = assessSkillDirectory(weakDir);

assert.equal(strong.status, 'verified_candidate');
assert.equal(strong.hasSourceManifest, true);
assert.equal(strong.researchFileCount, 6);
assert.equal(strong.failures.length, 0);

assert.equal(weak.status, 'draft');
assert.equal(weak.hasSourceManifest, false);
assert.ok(weak.failures.includes('missing_source_manifest'));
assert.ok(weak.failures.includes('research_too_thin'));

const similarity = compareAgenticProtocolSimilarity([
  { id: 'a', step2: repeatedProtocol },
  { id: 'b', step2: repeatedProtocol.replace('研究维度', '人物式研究维度') },
]);
assert.equal(similarity[0].tooSimilar, true);

const audit = auditRoundtableSkills(join(process.cwd(), '..', '..', 'roundtable-skills'));
const personAssessments = audit.assessments.filter((item: SkillQualityAssessment) => item.type === 'person');
assert.equal(personAssessments.length >= 7, true);
assert.equal(personAssessments.every((item) => item.status !== 'verified'), true);
assert.equal(audit.summary.verified, 0);
assert.equal(audit.summary.draft >= 7, true);

console.log(JSON.stringify({
  status: 'pass',
  tmpRoot,
  currentRoundtableDraftPeople: personAssessments.map((item) => ({
    id: item.id,
    status: item.status,
    failures: item.failures,
  })),
}, null, 2));
```

- [ ] **Step 2: Add the npm script**

Modify `workspace/frontend/package.json` scripts with:

```json
"test:roundtable-skill-quality": "tsc --target ES2022 --module commonjs --moduleResolution node --outDir .tmp-roundtable-test --skipLibCheck --esModuleInterop --types node --noEmit false lib/roundtable-skill-quality.ts scripts/roundtable-skill-quality-test.ts && node .tmp-roundtable-test/scripts/roundtable-skill-quality-test.js"
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm run test:roundtable-skill-quality
```

Expected: FAIL because `../lib/roundtable-skill-quality` does not exist.

- [ ] **Step 4: Implement the quality gate**

Create `workspace/frontend/lib/roundtable-skill-quality.ts` with exported functions:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export type SkillQualityStatus = 'verified' | 'verified_candidate' | 'draft';
export type SkillQualityFailure =
  | 'missing_skill'
  | 'missing_research_files'
  | 'research_too_thin'
  | 'missing_source_manifest'
  | 'too_few_primary_sources'
  | 'missing_agentic_protocol';

export interface SkillQualityAssessment {
  id: string;
  type: 'person' | 'functional' | 'unknown';
  path: string;
  status: SkillQualityStatus;
  skillChars: number;
  researchFileCount: number;
  researchChars: number;
  primarySourceMentions: number;
  hasSourceManifest: boolean;
  step2: string;
  failures: SkillQualityFailure[];
}

export interface ProtocolSimilarity {
  leftId: string;
  rightId: string;
  score: number;
  tooSimilar: boolean;
}

export interface SkillAuditReport {
  root: string;
  generatedAt: string;
  assessments: SkillQualityAssessment[];
  protocolSimilarity: ProtocolSimilarity[];
  summary: {
    total: number;
    verified: number;
    verifiedCandidate: number;
    draft: number;
  };
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function listMarkdownFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => join(path, name));
}

function countPrimaryMentions(value: string): number {
  const matches = value.match(/primary|一手|本人|股东信|演讲|访谈|transcript|letter|book|著作/gi);
  return matches?.length || 0;
}

function extractStep2(skill: string): string {
  const start = skill.search(/###\s*Step\s*2|Step 2|研究维度/i);
  if (start < 0) return '';
  const rest = skill.slice(start);
  const next = rest.slice(1).search(/\n###\s*Step\s*3|\n##\s+/i);
  return (next >= 0 ? rest.slice(0, next + 1) : rest).trim();
}

function inferType(skillDir: string, skill: string): SkillQualityAssessment['type'] {
  const id = basename(skillDir);
  if (/perspective|musk|bezos|jobs|thiel|grove|walton|drucker/i.test(id)) return 'person';
  if (/agent|keeper|chair|summary|consensus/i.test(id) || /岗位|职能/.test(skill)) return 'functional';
  return 'unknown';
}

export function assessSkillDirectory(skillDir: string): SkillQualityAssessment {
  const id = basename(skillDir);
  const skillPath = join(skillDir, 'SKILL.md');
  const skill = readIfExists(skillPath);
  const researchFiles = listMarkdownFiles(join(skillDir, 'references', 'research'));
  const researchText = researchFiles.map(readIfExists).join('\n');
  const manifestPath = join(skillDir, 'references', 'sources', 'source-manifest.json');
  const hasSourceManifest = existsSync(manifestPath);
  const sourceManifest = readIfExists(manifestPath);
  const failures: SkillQualityFailure[] = [];

  if (!skill) failures.push('missing_skill');
  if (researchFiles.length < 6 && inferType(skillDir, skill) === 'person') failures.push('missing_research_files');
  if (researchText.length < 6000 && inferType(skillDir, skill) === 'person') failures.push('research_too_thin');
  if (!hasSourceManifest && inferType(skillDir, skill) === 'person') failures.push('missing_source_manifest');

  const primarySourceMentions = countPrimaryMentions(skill + '\n' + researchText + '\n' + sourceManifest);
  if (inferType(skillDir, skill) === 'person' && primarySourceMentions < 10) failures.push('too_few_primary_sources');

  const step2 = extractStep2(skill);
  if (!step2 && inferType(skillDir, skill) === 'person') failures.push('missing_agentic_protocol');

  const type = inferType(skillDir, skill);
  const status: SkillQualityStatus = failures.length
    ? 'draft'
    : type === 'person'
      ? 'verified_candidate'
      : 'verified_candidate';

  return {
    id,
    type,
    path: skillDir,
    status,
    skillChars: skill.length,
    researchFileCount: researchFiles.length,
    researchChars: researchText.length,
    primarySourceMentions,
    hasSourceManifest,
    step2,
    failures,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ')
    .split(/\s+/)
    .filter((item) => item.length > 1));
}

export function compareAgenticProtocolSimilarity(items: Array<{ id: string; step2: string }>): ProtocolSimilarity[] {
  const results: ProtocolSimilarity[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = tokenSet(items[i].step2);
      const right = tokenSet(items[j].step2);
      const intersection = [...left].filter((token) => right.has(token)).length;
      const union = new Set([...left, ...right]).size || 1;
      const score = intersection / union;
      results.push({
        leftId: items[i].id,
        rightId: items[j].id,
        score,
        tooSimilar: score >= 0.72,
      });
    }
  }
  return results;
}

export function auditRoundtableSkills(root: string): SkillAuditReport {
  const dirs = existsSync(root)
    ? readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => statSync(path).isDirectory())
    : [];
  const assessments = dirs.map(assessSkillDirectory);
  const protocolSimilarity = compareAgenticProtocolSimilarity(
    assessments
      .filter((item) => item.type === 'person')
      .map((item) => ({ id: item.id, step2: item.step2 })),
  );
  const withSimilarityFailures = assessments.map((item) => {
    if (item.type !== 'person') return item;
    const tooSimilar = protocolSimilarity.some((pair) =>
      pair.tooSimilar && (pair.leftId === item.id || pair.rightId === item.id)
    );
    if (!tooSimilar || item.failures.includes('missing_agentic_protocol')) return item;
    return { ...item, status: 'draft' as const, failures: [...item.failures] };
  });
  return {
    root,
    generatedAt: new Date().toISOString(),
    assessments: withSimilarityFailures,
    protocolSimilarity,
    summary: {
      total: withSimilarityFailures.length,
      verified: withSimilarityFailures.filter((item) => item.status === 'verified').length,
      verifiedCandidate: withSimilarityFailures.filter((item) => item.status === 'verified_candidate').length,
      draft: withSimilarityFailures.filter((item) => item.status === 'draft').length,
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```powershell
npm run test:roundtable-skill-quality
```

Expected: PASS and report all current public-person skills as draft.

- [ ] **Step 6: Commit**

```powershell
git add workspace/frontend/lib/roundtable-skill-quality.ts workspace/frontend/scripts/roundtable-skill-quality-test.ts workspace/frontend/package.json
git commit -m "feat: add roundtable skill quality gate"
```

## Task 2: Role Agent Domain Model

**Files:**
- Create: `workspace/frontend/lib/roundtable-role-agent.ts`
- Create: `workspace/frontend/scripts/roundtable-role-agent-contract-test.ts`
- Modify: `workspace/frontend/lib/roundtable-engine.ts`
- Modify: `workspace/frontend/lib/roundtable-preset-agents.ts`
- Modify: `workspace/frontend/package.json`

- [ ] **Step 1: Write the failing test**

Create `workspace/frontend/scripts/roundtable-role-agent-contract-test.ts` with:

```ts
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
```

- [ ] **Step 2: Add the npm script**

Modify `workspace/frontend/package.json` scripts with:

```json
"test:roundtable-role-agent": "tsc --target ES2022 --module commonjs --moduleResolution node --outDir .tmp-roundtable-test --skipLibCheck --esModuleInterop --types node --noEmit false lib/roundtable-engine.ts lib/roundtable-role-agent.ts scripts/roundtable-role-agent-contract-test.ts && node .tmp-roundtable-test/scripts/roundtable-role-agent-contract-test.js"
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm run test:roundtable-role-agent
```

Expected: FAIL because `roundtable-role-agent.ts` and new metadata fields do not exist.

- [ ] **Step 4: Extend the engine model**

Modify `workspace/frontend/lib/roundtable-engine.ts`:

```ts
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
```

Add these optional fields to `RoundtableAgent`:

```ts
  agentKind: RoundtableAgentKind;
  participationMode: RoundtableParticipationMode;
  skillId?: string;
  skillSourcePath?: string;
  skillLoadStatus: RoundtableSkillLoadStatus;
  corpusPath?: string;
  sourceManifestPath?: string;
  qualityScores?: RoundtableQualityScores;
  avatarSource?: string;
```

Update `createRoundtableAgent` default return:

```ts
    agentKind: input.agentKind || 'custom',
    participationMode: input.participationMode || 'participant',
    skillId: input.skillId,
    skillSourcePath: input.skillSourcePath,
    skillLoadStatus: input.skillLoadStatus || (input.skillSourcePath ? 'installed' : 'legacy_prompt'),
    corpusPath: input.corpusPath,
    sourceManifestPath: input.sourceManifestPath,
    qualityScores: input.qualityScores,
    avatarSource: input.avatarSource,
```

Update `createDemoAgents` to pass through the same fields from presets.

- [ ] **Step 5: Create role-agent helpers**

Create `workspace/frontend/lib/roundtable-role-agent.ts` with:

```ts
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
```

- [ ] **Step 6: Add preset metadata**

Modify `workspace/frontend/lib/roundtable-preset-agents.ts` interface:

```ts
import type {
  RoundtableAgentKind,
  RoundtableAgentRuntime,
  RoundtableParticipationMode,
  RoundtableQualityScores,
  RoundtableSkillLoadStatus,
} from './roundtable-engine';

export interface RoundtablePresetAgent {
  id: string;
  name: string;
  avatar: string;
  roleLabel: string;
  roleDescription: string;
  responsibility: string;
  runtime: RoundtableAgentRuntime;
  agentKind: RoundtableAgentKind;
  participationMode: RoundtableParticipationMode;
  skillId: string;
  skillSourcePath: string;
  skillLoadStatus: RoundtableSkillLoadStatus;
  corpusPath?: string;
  sourceManifestPath?: string;
  qualityScores?: RoundtableQualityScores;
  avatarSource?: string;
  skillContent: string;
}
```

For public figures, set:

```ts
"agentKind": "public_figure",
"participationMode": "participant",
"skillId": "<same as id>",
"skillLoadStatus": "draft_skill",
"corpusPath": "openagents/roundtable-skills/<id>/references",
"sourceManifestPath": "openagents/roundtable-skills/<id>/references/sources/source-manifest.json",
"qualityScores": { "persona": 0, "evidence": 0, "intensity": 0, "actionability": 0 },
"avatarSource": "public roundtable avatar asset"
```

For policy, market, medical, fact-pack, company-context functional agents, set:

```ts
"agentKind": "functional",
"participationMode": "background_research",
"skillLoadStatus": "draft_skill"
```

For `roundtable-chair`, set:

```ts
"agentKind": "chair",
"participationMode": "chair",
"skillLoadStatus": "draft_skill"
```

- [ ] **Step 7: Run test to verify it passes**

Run:

```powershell
npm run test:roundtable-role-agent
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add workspace/frontend/lib/roundtable-engine.ts workspace/frontend/lib/roundtable-role-agent.ts workspace/frontend/lib/roundtable-preset-agents.ts workspace/frontend/scripts/roundtable-role-agent-contract-test.ts workspace/frontend/package.json
git commit -m "feat: add roundtable role agent model"
```

## Task 3: Role Agent Runtime Prompts

**Files:**
- Modify: `workspace/frontend/lib/roundtable-runtime.ts`
- Modify: `workspace/frontend/scripts/roundtable-runtime-product-contract-test.ts`
- Modify: `workspace/frontend/scripts/roundtable-product-path-self-test.ts`
- Modify: `workspace/frontend/scripts/roundtable-self-test.ts`

- [ ] **Step 1: Update failing runtime contract**

Modify `workspace/frontend/scripts/roundtable-runtime-product-contract-test.ts` so the first loop asserts Role Agent prompts do not include private markers:

```ts
for (const plan of round1Plan) {
  assert.match(plan.prompt, /Skill ID:/, `${plan.agentName} prompt should describe skill identity`);
  assert.match(plan.prompt, /Skill load status:/, `${plan.agentName} prompt should include load status`);
  for (const marker of markers) {
    assert.doesNotMatch(plan.prompt, new RegExp(marker), `${plan.agentName} role-agent prompt leaked full skill marker ${marker}`);
  }
  assert.doesNotMatch(plan.prompt, /仅供该 Agent 使用的私有 Skill 内容/);
}
```

Update test agent creation to set role-agent metadata:

```ts
agentKind: 'public_figure',
participationMode: 'participant',
skillId: 'alpha-skill',
skillSourcePath: 'roundtable-skills/alpha/SKILL.md',
skillLoadStatus: 'verified_loaded',
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test:roundtable-runtime
```

Expected: FAIL because `getRuntimeRoundPlan` still builds prompts with `renderAgentPrompt`.

- [ ] **Step 3: Switch runtime plan to Role Agent prompt**

Modify `workspace/frontend/lib/roundtable-runtime.ts` imports:

```ts
import { buildRoleAgentTaskPrompt, getAgentSkillMode } from './roundtable-role-agent';
```

Replace `buildPrompt` with:

```ts
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
```

Update call site:

```ts
prompt: buildPrompt(state, agent, phaseId, interaction.interactionType, targetAgentNames, instruction),
```

- [ ] **Step 4: Keep background agents off stage**

Modify `getRuntimeRoundPlan` selected agents:

```ts
const selectedAgents = getSelectedAgents(state).filter((agent) => agent.participationMode !== 'background_research' && agent.participationMode !== 'judge');
```

- [ ] **Step 5: Update legacy tests**

In `roundtable-self-test.ts` and `roundtable-product-path-self-test.ts`, update marker assertions to reflect mode:

```ts
assert.equal(plan.prompt.includes('SECRET_SKILL_ACTIVE_ONLY'), false);
```

For any test that explicitly calls `renderAgentPrompt`, keep the old assertion only when testing legacy prompt behavior.

- [ ] **Step 6: Run runtime tests**

Run:

```powershell
npm run test:roundtable-runtime
npm run test:roundtable
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add workspace/frontend/lib/roundtable-runtime.ts workspace/frontend/scripts/roundtable-runtime-product-contract-test.ts workspace/frontend/scripts/roundtable-product-path-self-test.ts workspace/frontend/scripts/roundtable-self-test.ts
git commit -m "feat: use role agent prompts in roundtable runtime"
```

## Task 4: CLI Command Builder And Role-Agent Mode

**Files:**
- Modify: `workspace/frontend/lib/roundtable-cli-runner.ts`
- Modify: `workspace/frontend/app/api/roundtable/runtime/route.ts`
- Create: `workspace/frontend/scripts/roundtable-cli-command-contract-test.ts`
- Modify: `workspace/frontend/package.json`

- [ ] **Step 1: Write the failing test**

Create `workspace/frontend/scripts/roundtable-cli-command-contract-test.ts`:

```ts
import assert from 'node:assert/strict';
import {
  buildCodexArgs,
  buildClaudeArgs,
  type RoundtableCliRunInput,
} from '../lib/roundtable-cli-runner';

const roleInput: RoundtableCliRunInput = {
  runtime: 'codex_cli',
  prompt: 'Role task prompt without skill body',
  agentName: '埃隆·马斯克',
  phaseId: 'round2',
  roleAgent: {
    skillId: 'musk-first-principles-perspective',
    skillPath: 'roundtable-skills/musk-first-principles-perspective/SKILL.md',
    skillLoadStatus: 'verified_loaded',
    mode: 'role_agent',
  },
};

const roleArgs = buildCodexArgs({
  input: roleInput,
  outputPath: 'out.txt',
  runtimeCwd: 'C:/repo',
});

assert.equal(roleArgs.includes('--ignore-user-config'), false);
assert.equal(roleArgs.includes('--ignore-rules'), false);
assert.equal(roleArgs.includes('--ephemeral'), false);
assert.equal(roleArgs.includes('--cd'), true);
assert.equal(roleArgs.includes('C:/repo'), true);

const legacyArgs = buildCodexArgs({
  input: { ...roleInput, roleAgent: undefined },
  outputPath: 'out.txt',
  runtimeCwd: 'C:/repo',
});
assert.equal(legacyArgs.includes('--ignore-user-config'), true);
assert.equal(legacyArgs.includes('--ignore-rules'), true);
assert.equal(legacyArgs.includes('--ephemeral'), true);

const claudeArgs = buildClaudeArgs(roleInput);
assert.equal(claudeArgs.includes('--disable-slash-commands'), false);
assert.equal(claudeArgs.includes('--no-session-persistence'), false);

console.log(JSON.stringify({ status: 'pass', roleArgs, legacyArgs }, null, 2));
```

- [ ] **Step 2: Add npm script**

Modify `workspace/frontend/package.json` scripts:

```json
"test:roundtable-cli-command": "tsc --target ES2022 --module commonjs --moduleResolution node --outDir .tmp-roundtable-test --skipLibCheck --esModuleInterop --types node --noEmit false lib/roundtable-engine.ts lib/roundtable-cli-runner.ts scripts/roundtable-cli-command-contract-test.ts && node .tmp-roundtable-test/scripts/roundtable-cli-command-contract-test.js"
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm run test:roundtable-cli-command
```

Expected: FAIL because `buildCodexArgs`, `buildClaudeArgs`, and `roleAgent` input do not exist.

- [ ] **Step 4: Implement pure command builders**

Modify `workspace/frontend/lib/roundtable-cli-runner.ts`:

```ts
export interface RoundtableRoleAgentRunConfig {
  mode: 'role_agent';
  skillId?: string;
  skillPath?: string;
  skillLoadStatus?: string;
  profileDir?: string;
}

export interface RoundtableCliRunInput {
  runtime: Exclude<RoundtableAgentRuntime, 'demo'>;
  prompt: string;
  agentName: string;
  phaseId: string;
  timeoutMs?: number;
  roleAgent?: RoundtableRoleAgentRunConfig;
}

export function buildCodexArgs(input: {
  input: RoundtableCliRunInput;
  outputPath: string;
  runtimeCwd: string;
}): string[] {
  const isRoleAgent = input.input.roleAgent?.mode === 'role_agent';
  const base = [
    'exec',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--cd',
    input.runtimeCwd,
    '-o',
    input.outputPath,
    '-',
  ];
  return isRoleAgent ? base : [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '--ignore-rules',
    '--color',
    'never',
    '--cd',
    input.runtimeCwd,
    '-o',
    input.outputPath,
    '-',
  ];
}

export function buildClaudeArgs(input: RoundtableCliRunInput): string[] {
  const base = ['-p', input.prompt, '--output-format', 'text'];
  return input.roleAgent?.mode === 'role_agent'
    ? base
    : [...base, '--no-session-persistence', '--disable-slash-commands'];
}
```

Use `buildCodexArgs` inside `runCodex`, and `buildClaudeArgs` inside `runClaude`.

- [ ] **Step 5: Pass roleAgent through API**

Modify `workspace/frontend/app/api/roundtable/runtime/route.ts` body:

```ts
  roleAgent?: {
    mode: 'role_agent';
    skillId?: string;
    skillPath?: string;
    skillLoadStatus?: string;
    profileDir?: string;
  };
```

Pass it into `runRoundtableCliAgent`.

- [ ] **Step 6: Run command test**

Run:

```powershell
npm run test:roundtable-cli-command
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add workspace/frontend/lib/roundtable-cli-runner.ts workspace/frontend/app/api/roundtable/runtime/route.ts workspace/frontend/scripts/roundtable-cli-command-contract-test.ts workspace/frontend/package.json
git commit -m "feat: add role agent cli command mode"
```

## Task 5: Deterministic Quality Judge

**Files:**
- Create: `workspace/frontend/lib/roundtable-quality-judge.ts`
- Create: `workspace/frontend/scripts/roundtable-quality-judge-test.ts`
- Modify: `workspace/frontend/lib/roundtable-runtime.ts`
- Modify: `workspace/frontend/package.json`

- [ ] **Step 1: Write the failing test**

Create `workspace/frontend/scripts/roundtable-quality-judge-test.ts`:

```ts
import assert from 'node:assert/strict';
import { judgeRoundtableOutput } from '../lib/roundtable-quality-judge';

const masked = judgeRoundtableOutput({
  content: '我以“埃隆·马斯克视角”参与，非本人观点。你的挑战成立。',
  interactionType: 'challenge',
  targetAgentIds: [],
});
assert.equal(masked.pass, false);
assert.ok(masked.failures.includes('mask_language'));

const strong = judgeRoundtableOutput({
  content: '彼得，这里不是战略问题，是证据链断了。先拿三家医院的采用意愿、合规边界和一周内可跑的失败判据，否则别扩大投入。',
  interactionType: 'challenge',
  targetAgentIds: ['drucker'],
  evidenceRequest: '三家医院采用意愿、合规边界、一周内失败判据。',
});
assert.equal(strong.pass, true);
assert.equal(strong.scores.disagreementIntensity >= 0.6, true);
assert.equal(strong.scores.evidenceDiscipline >= 0.6, true);
assert.equal(strong.scores.actionability >= 0.6, true);

console.log(JSON.stringify({ status: 'pass', strong }, null, 2));
```

- [ ] **Step 2: Add npm script**

```json
"test:roundtable-quality-judge": "tsc --target ES2022 --module commonjs --moduleResolution node --outDir .tmp-roundtable-test --skipLibCheck --esModuleInterop --types node --noEmit false lib/roundtable-engine.ts lib/roundtable-quality-judge.ts scripts/roundtable-quality-judge-test.ts && node .tmp-roundtable-test/scripts/roundtable-quality-judge-test.js"
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```powershell
npm run test:roundtable-quality-judge
```

Expected: FAIL because the judge file does not exist.

- [ ] **Step 4: Implement deterministic judge**

Create `workspace/frontend/lib/roundtable-quality-judge.ts` with:

```ts
import type { InteractionType } from './roundtable-engine';

export type QualityFailure =
  | 'mask_language'
  | 'too_generic'
  | 'weak_challenge'
  | 'missing_evidence_boundary'
  | 'missing_action';

export interface JudgeInput {
  content: string;
  interactionType: InteractionType;
  targetAgentIds: string[];
  evidenceRequest?: string;
}

export interface JudgeResult {
  pass: boolean;
  failures: QualityFailure[];
  scores: {
    personaFidelity: number;
    commercialSharpness: number;
    evidenceDiscipline: number;
    disagreementIntensity: number;
    actionability: number;
    antiMaskLanguage: number;
  };
}

function hasAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}

function score(condition: boolean): number {
  return condition ? 0.8 : 0.2;
}

export function judgeRoundtableOutput(input: JudgeInput): JudgeResult {
  const content = input.content.trim();
  const failures: QualityFailure[] = [];
  const hasMask = /我以|非本人观点|目标对象|作为(?:一个)?\s*AI|你的挑战成立|我接受你的挑战/.test(content);
  const hasEvidence = hasAny(content, ['证据', '未证实', '验证', '来源', '样本', '指标', '边界', '失败判据']);
  const hasAction = hasAny(content, ['下一步', '先拿', '一周', '试点', '停止', '扩大投入', '负责人', '时间窗口', '失败判据']);
  const hasChallenge = input.targetAgentIds.length > 0 || hasAny(content, ['不是', '别', '先别', '问题是', '断了', '挑战', '反对']);
  const hasCommercial = hasAny(content, ['客户', '成本', '商业', '采用', '医院', '渠道', '投入', '现金流', '资源', '规模']);
  const tooGeneric = content.length < 40 || !hasAny(content, ['证据', '客户', '成本', '采用', '资源', '指标', '风险', '验证']);

  if (hasMask) failures.push('mask_language');
  if (tooGeneric) failures.push('too_generic');
  if ((input.interactionType === 'challenge' || input.interactionType === 'evidence_request') && !hasChallenge) failures.push('weak_challenge');
  if (!hasEvidence) failures.push('missing_evidence_boundary');
  if (!hasAction) failures.push('missing_action');

  const scores = {
    personaFidelity: score(!hasMask && !tooGeneric),
    commercialSharpness: score(hasCommercial),
    evidenceDiscipline: score(hasEvidence || Boolean(input.evidenceRequest)),
    disagreementIntensity: score(hasChallenge),
    actionability: score(hasAction),
    antiMaskLanguage: hasMask ? 0 : 1,
  };

  return {
    pass: failures.length === 0,
    failures,
    scores,
  };
}
```

- [ ] **Step 5: Attach judge result to normalized output**

Modify `NormalizedRuntimeOutput` in `roundtable-runtime.ts`:

```ts
  judge?: JudgeResult;
```

Import and call:

```ts
import { judgeRoundtableOutput, type JudgeResult } from './roundtable-quality-judge';
```

At the end of `normalizeRuntimeOutput`, add:

```ts
  const judged = {
    content,
    interactionType,
    targetAgentIds: targetIds.length ? targetIds : plan.targetAgentIds,
    relatedIdea,
    evidenceRequest: evidenceRequest || (interactionType === 'evidence_request' ? content : undefined),
  };
  return {
    ...judged,
    judge: judgeRoundtableOutput(judged),
  };
```

- [ ] **Step 6: Run judge and runtime tests**

```powershell
npm run test:roundtable-quality-judge
npm run test:roundtable-runtime
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add workspace/frontend/lib/roundtable-quality-judge.ts workspace/frontend/lib/roundtable-runtime.ts workspace/frontend/scripts/roundtable-quality-judge-test.ts workspace/frontend/package.json
git commit -m "feat: add roundtable output quality judge"
```

## Task 6: Agent Registry UI Status

**Files:**
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`
- Modify: `workspace/frontend/scripts/roundtable-ui-contract-test.ts`

- [ ] **Step 1: Write failing UI contract**

Modify `workspace/frontend/scripts/roundtable-ui-contract-test.ts` required markers:

```ts
for (const required of [
  'Agent Registry',
  'Verified Role Agent',
  'Legacy Prompt',
  'Draft Skill',
  '后台研究',
  'Skill 状态',
  '质量分',
]) {
  assert.ok(source.includes(required), `missing role-agent UI marker: ${required}`);
}
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
npm run test:roundtable-ui
```

Expected: FAIL because UI does not include the new registry markers.

- [ ] **Step 3: Add UI helpers**

In `roundtable-view.tsx`, import:

```ts
import { getAgentSkillMode, isBackgroundOnlyAgent } from '@/lib/roundtable-role-agent';
```

Add helpers near other label maps:

```ts
const skillModeLabels = {
  verified_role_agent: 'Verified Role Agent',
  installed_unverified: 'Installed / Unverified',
  draft_role_agent: 'Draft Skill',
  background_agent: '后台研究',
  legacy_prompt: 'Legacy Prompt',
} as const;

const skillModeTone = {
  verified_role_agent: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
  installed_unverified: 'border-sky-400/40 bg-sky-500/15 text-sky-200',
  draft_role_agent: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
  background_agent: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200',
  legacy_prompt: 'border-rose-400/40 bg-rose-500/15 text-rose-200',
} as const;
```

- [ ] **Step 4: Rename management title and show statuses**

In the agent dialog title, change:

```tsx
<DialogTitle>管理智能体</DialogTitle>
```

to:

```tsx
<DialogTitle>Agent Registry · 管理智能体</DialogTitle>
```

In each agent card/list row, render:

```tsx
const mode = getAgentSkillMode(item);
```

and:

```tsx
<Pill className={skillModeTone[mode]}>{skillModeLabels[mode]}</Pill>
```

In the detail panel, add visible labels:

```tsx
<Label className={darkLabelClass}>Skill 状态</Label>
<Pill className={skillModeTone[getAgentSkillMode(agent)]}>{skillModeLabels[getAgentSkillMode(agent)]}</Pill>
<Label className={darkLabelClass}>质量分</Label>
```

For `isBackgroundOnlyAgent(agent)`, show:

```tsx
<p className="text-xs text-cyan-200">后台研究 Agent 默认不参与台前讨论，只有被调用时补充事实。</p>
```

- [ ] **Step 5: Run UI contract**

```powershell
npm run test:roundtable-ui
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add workspace/frontend/components/roundtable/roundtable-view.tsx workspace/frontend/scripts/roundtable-ui-contract-test.ts
git commit -m "feat: show role agent registry status"
```

## Task 7: P1 Product Path Contract

**Files:**
- Modify: `workspace/frontend/scripts/roundtable-product-path-self-test.ts`
- Modify: `workspace/frontend/package.json`

- [ ] **Step 1: Update product path expectations**

In `roundtable-product-path-self-test.ts`, replace `assertSkillContext` with:

```ts
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
```

Update the summary property name from `contextChecks` to `roleAgentContextChecks`.

- [ ] **Step 2: Ensure test agents include metadata**

In `createAgents`, add to each public participant:

```ts
agentKind: 'public_figure',
participationMode: 'participant',
skillId: '<agent-id>-skill',
skillSourcePath: 'roundtable-skills/<agent-id>/SKILL.md',
skillLoadStatus: 'verified_loaded',
```

For chair:

```ts
agentKind: 'chair',
participationMode: 'chair',
skillId: 'chair-skill',
skillSourcePath: 'roundtable-skills/roundtable-chair/SKILL.md',
skillLoadStatus: 'installed',
```

- [ ] **Step 3: Run product-path compile test**

```powershell
npm run test:roundtable-product-path
```

Expected: PASS if local runtime API is mocked or server is running; if it attempts live CLI and times out, document it as environment-dependent and run compile command directly:

```powershell
npx tsc --target ES2022 --module commonjs --moduleResolution node --outDir .tmp-roundtable-test --skipLibCheck --esModuleInterop --types node --noEmit false lib/roundtable-engine.ts lib/roundtable-runtime.ts scripts/roundtable-product-path-self-test.ts
```

- [ ] **Step 4: Commit**

```powershell
git add workspace/frontend/scripts/roundtable-product-path-self-test.ts workspace/frontend/package.json
git commit -m "test: update roundtable product path for role agents"
```

## Task 8: Verification Sweep

**Files:**
- No new source files unless a previous test exposes a compile issue.

- [ ] **Step 1: Run focused tests**

```powershell
npm run test:roundtable-skill-quality
npm run test:roundtable-role-agent
npm run test:roundtable-runtime
npm run test:roundtable-cli-command
npm run test:roundtable-quality-judge
npm run test:roundtable-ui
npm run test:roundtable
```

Expected: all PASS.

- [ ] **Step 2: Run build**

```powershell
npm run build
```

Expected: PASS. If build fails due unrelated existing workspace issues, capture the exact error and do not claim build pass.

- [ ] **Step 3: Produce P1 audit artifact**

Run:

```powershell
npm run test:roundtable-skill-quality > ..\..\output\roundtable-role-agent-p1-skill-audit.log
```

Expected: log includes current public-figure skills as draft, proving P1 correctly blocks weak skills from verified status.

- [ ] **Step 4: Inspect git diff**

```powershell
git status --short
git diff --stat
```

Expected: only P1 files changed by this plan plus existing unrelated dirty files remain.

- [ ] **Step 5: Final commit if needed**

If any verification-only fixes were made:

```powershell
git add <changed P1 files>
git commit -m "fix: stabilize role agent p1 verification"
```

## Self-Review Checklist

- Spec coverage:
  - Skill Factory guardrails: Task 1.
  - Role Agent metadata: Task 2.
  - No full Skill prompt injection in role-agent mode: Task 3.
  - Runtime command mode without forced ignore flags: Task 4.
  - Output judge: Task 5.
  - Agent Registry UI state: Task 6.
  - Product-path guardrails: Task 7.
  - Verification: Task 8.

- Placeholder scan:
  - The plan contains no unfinished markers or unspecified code steps.

- Type consistency:
  - `RoundtableAgentKind`, `RoundtableParticipationMode`, and `RoundtableSkillLoadStatus` are defined in `roundtable-engine.ts`.
  - `buildRoleAgentTaskPrompt` uses those fields and is called from `roundtable-runtime.ts`.
  - `RoundtableCliRunInput.roleAgent` is accepted by API and runner.

## Execution Mode

Because the user already confirmed "执行", use inline execution in this session unless a task becomes safely separable and the user explicitly asks for parallel subagents. Execute with Superpowers TDD discipline: write failing test, verify red, implement, verify green.
