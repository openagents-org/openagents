# Roundtable P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a frontend-first multi-agent roundtable workbench for OpenAgents P0 using existing workspace agents, sessions, messages, files, knowledge, and browser APIs.

**Architecture:** Add a new `roundtable` workspace view. Keep roundtable state, prompt construction, phase progression, interaction extraction, and Markdown export in focused frontend modules under `workspace/frontend/lib/roundtable`, then compose them in `workspace/frontend/components/roundtable`. Reuse existing backend APIs through `useWorkspace` and `workspaceApi`; do not add backend endpoints in P0.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Lucide React, existing OpenAgents workspace API client, Vitest for pure utility tests, `next build` for app verification.

---

## File Structure

- Create `workspace/frontend/lib/roundtable/types.ts`: P0 domain types and constants.
- Create `workspace/frontend/lib/roundtable/state.ts`: default state creation, phase progression, agent and Fact Pack mutations.
- Create `workspace/frontend/lib/roundtable/interactions.ts`: deterministic message-to-interaction extraction.
- Create `workspace/frontend/lib/roundtable/prompts.ts`: kickoff, phase, intervention, and search request prompt builders.
- Create `workspace/frontend/lib/roundtable/export.ts`: Markdown export builder.
- Create `workspace/frontend/lib/roundtable/storage.ts`: workspace settings serialization helpers.
- Create `workspace/frontend/lib/roundtable/__tests__/state.test.ts`: phase and mutation tests.
- Create `workspace/frontend/lib/roundtable/__tests__/interactions.test.ts`: mention/challenge/response/evidence extraction tests.
- Create `workspace/frontend/lib/roundtable/__tests__/export.test.ts`: Markdown export tests.
- Create `workspace/frontend/vitest.config.ts`: Vitest config for pure TypeScript tests.
- Modify `workspace/frontend/package.json`: add `test` script and `vitest` dev dependency.
- Modify `workspace/frontend/package-lock.json`: update lockfile through `npm install`.
- Create `workspace/frontend/components/roundtable/roundtable-view.tsx`: top-level workbench.
- Create `workspace/frontend/components/roundtable/roundtable-setup-panel.tsx`: topic, goal, output preference, and roundtable start controls.
- Create `workspace/frontend/components/roundtable/roundtable-agent-roster.tsx`: agent selection, enable/disable, role, duty, and Skill import.
- Create `workspace/frontend/components/roundtable/fact-pack-panel.tsx`: facts, file upload, search requests, evidence requests.
- Create `workspace/frontend/components/roundtable/phase-rail.tsx`: four-phase progression controls.
- Create `workspace/frontend/components/roundtable/interaction-map.tsx`: avatar row and visible relationship lines.
- Create `workspace/frontend/components/roundtable/roundtable-transcript.tsx`: polled transcript view.
- Create `workspace/frontend/components/roundtable/human-intervention-bar.tsx`: pause, resume, context, evidence, challenge, answer, stop actions.
- Create `workspace/frontend/components/roundtable/final-output-panel.tsx`: structured output editor and Markdown export.
- Modify `workspace/frontend/components/layout/layout-context.tsx`: add `roundtable` to `ViewMode`.
- Modify `workspace/frontend/components/layout/sidebar-content.tsx`: add `Roundtable` nav item.
- Modify `workspace/frontend/components/layout/wrapper.tsx`: render `RoundtableView` on desktop and mobile.

## Task 1: Add Test Harness

**Files:**
- Modify: `workspace/frontend/package.json`
- Modify: `workspace/frontend/package-lock.json`
- Create: `workspace/frontend/vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run:

```powershell
cd 'C:\Vibe Coding Project\AgentHive\openagents\workspace\frontend'
npm install --save-dev vitest
```

Expected: `package.json` gains a `vitest` dev dependency and `package-lock.json` updates.

- [ ] **Step 2: Add test scripts**

In `workspace/frontend/package.json`, set scripts to:

```json
{
  "dev": "next dev -p 3001",
  "build": "next build",
  "start": "next start -p 3000",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Add Vitest config**

Create `workspace/frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify empty test run**

Run:

```powershell
npm test -- --passWithNoTests
```

Expected: PASS with no test files found or no tests run.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/package.json workspace/frontend/package-lock.json workspace/frontend/vitest.config.ts
git commit -m "test: add frontend vitest harness"
```

## Task 2: Roundtable Domain Types

**Files:**
- Create: `workspace/frontend/lib/roundtable/types.ts`
- Create: `workspace/frontend/lib/roundtable/__tests__/state.test.ts`

- [ ] **Step 1: Write failing type-adjacent state test**

Create `workspace/frontend/lib/roundtable/__tests__/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRoundtableState } from '../state';

describe('createRoundtableState', () => {
  it('creates a setup draft with empty meeting fields and no session', () => {
    const state = createRoundtableState();

    expect(state.phase).toBe('setup');
    expect(state.topic).toBe('');
    expect(state.goal).toBe('');
    expect(state.sessionId).toBeNull();
    expect(state.agents).toEqual([]);
    expect(state.factPack).toEqual([]);
    expect(state.interactions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- lib/roundtable/__tests__/state.test.ts
```

Expected: FAIL because `../state` does not exist.

- [ ] **Step 3: Add types**

Create `workspace/frontend/lib/roundtable/types.ts`:

```ts
export type RoundtablePhase = 'setup' | 'initial' | 'challenge' | 'revise' | 'converge' | 'complete';

export const ROUNDTABLE_PHASES: RoundtablePhase[] = [
  'setup',
  'initial',
  'challenge',
  'revise',
  'converge',
  'complete',
];

export type FactSourceStatus = 'sourced' | 'user_provided' | 'inferred' | 'unverified';

export interface RoundtableAgentConfig {
  id: string;
  workspaceAgentName: string;
  displayName: string;
  avatarSeed: string;
  avatarUrl: string | null;
  roleLabel: string;
  roleDescription: string;
  duty: string;
  skillMarkdown: string;
  enabled: boolean;
}

export interface FactPackItem {
  id: string;
  claim: string;
  sourceName: string;
  sourceUrl: string;
  sourceStatus: FactSourceStatus;
  uncertainty: string;
  createdBy: string;
  createdAt: string;
}

export interface EvidenceRequest {
  id: string;
  requestedBy: string;
  question: string;
  status: 'open' | 'answered' | 'dismissed';
  linkedFactId: string | null;
  createdAt: string;
}

export type RoundtableInteractionType = 'mention' | 'challenge' | 'response' | 'evidence_request';

export interface RoundtableInteraction {
  id: string;
  type: RoundtableInteractionType;
  fromAgent: string;
  toAgent: string | null;
  messageId: string | null;
  phase: RoundtablePhase;
  createdAt: string;
}

export interface RoundtableFinalOutput {
  ideas: string;
  supportingReasons: string;
  objections: string;
  keyRisks: string;
  consensus: string;
  disagreements: string;
  validationQuestions: string;
  nextSteps: string;
}

export interface RoundtableState {
  id: string;
  topic: string;
  goal: string;
  background: string;
  searchScope: string;
  outputPreference: string;
  sessionId: string | null;
  phase: RoundtablePhase;
  autoAdvance: boolean;
  isPaused: boolean;
  agents: RoundtableAgentConfig[];
  factPack: FactPackItem[];
  evidenceRequests: EvidenceRequest[];
  interactions: RoundtableInteraction[];
  finalOutput: RoundtableFinalOutput;
  updatedAt: string;
}
```

- [ ] **Step 4: Add minimal state factory**

Create `workspace/frontend/lib/roundtable/state.ts`:

```ts
import type { RoundtableFinalOutput, RoundtableState } from './types';

const emptyFinalOutput = (): RoundtableFinalOutput => ({
  ideas: '',
  supportingReasons: '',
  objections: '',
  keyRisks: '',
  consensus: '',
  disagreements: '',
  validationQuestions: '',
  nextSteps: '',
});

export function createRoundtableState(now = new Date()): RoundtableState {
  const timestamp = now.toISOString();
  return {
    id: `roundtable-${now.getTime()}`,
    topic: '',
    goal: '',
    background: '',
    searchScope: '',
    outputPreference: 'Structured Markdown for strategy review',
    sessionId: null,
    phase: 'setup',
    autoAdvance: false,
    isPaused: false,
    agents: [],
    factPack: [],
    evidenceRequests: [],
    interactions: [],
    finalOutput: emptyFinalOutput(),
    updatedAt: timestamp,
  };
}
```

- [ ] **Step 5: Run test**

Run:

```powershell
npm test -- lib/roundtable/__tests__/state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add workspace/frontend/lib/roundtable/types.ts workspace/frontend/lib/roundtable/state.ts workspace/frontend/lib/roundtable/__tests__/state.test.ts
git commit -m "feat: add roundtable domain state"
```

## Task 3: State Mutations And Phase Progression

**Files:**
- Modify: `workspace/frontend/lib/roundtable/state.ts`
- Modify: `workspace/frontend/lib/roundtable/__tests__/state.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `workspace/frontend/lib/roundtable/__tests__/state.test.ts`:

```ts
import type { RoundtableAgentConfig, FactPackItem } from '../types';
import { addOrUpdateAgent, addFactPackItem, advancePhase, updateMeetingFields } from '../state';

const agent: RoundtableAgentConfig = {
  id: 'agent-alpha',
  workspaceAgentName: 'alpha',
  displayName: 'Alpha',
  avatarSeed: 'alpha',
  avatarUrl: null,
  roleLabel: 'Customer challenger',
  roleDescription: 'Challenges customer value and adoption assumptions.',
  duty: 'Challenge weak customer logic.',
  skillMarkdown: '# Skill\nAsk for customer evidence.',
  enabled: true,
};

const fact: FactPackItem = {
  id: 'fact-1',
  claim: 'Hospital strategy ideas need explicit evidence boundaries.',
  sourceName: 'User brief',
  sourceUrl: '',
  sourceStatus: 'user_provided',
  uncertainty: '',
  createdBy: 'user',
  createdAt: '2026-06-08T00:00:00.000Z',
};

describe('roundtable state mutations', () => {
  it('updates meeting fields immutably', () => {
    const state = createRoundtableState(new Date('2026-06-08T00:00:00.000Z'));
    const next = updateMeetingFields(state, { topic: 'BD strategy', goal: 'Generate bold ideas' }, new Date('2026-06-08T00:01:00.000Z'));

    expect(next.topic).toBe('BD strategy');
    expect(next.goal).toBe('Generate bold ideas');
    expect(next.updatedAt).toBe('2026-06-08T00:01:00.000Z');
    expect(state.topic).toBe('');
  });

  it('adds and replaces agents by id', () => {
    const state = createRoundtableState();
    const withAgent = addOrUpdateAgent(state, agent);
    const renamed = addOrUpdateAgent(withAgent, { ...agent, displayName: 'Renamed Alpha' });

    expect(withAgent.agents).toHaveLength(1);
    expect(renamed.agents).toHaveLength(1);
    expect(renamed.agents[0].displayName).toBe('Renamed Alpha');
  });

  it('adds fact pack items', () => {
    const state = createRoundtableState();
    const next = addFactPackItem(state, fact);

    expect(next.factPack).toEqual([fact]);
  });

  it('advances through the P0 phases', () => {
    const state = createRoundtableState();

    expect(advancePhase(state).phase).toBe('initial');
    expect(advancePhase({ ...state, phase: 'initial' }).phase).toBe('challenge');
    expect(advancePhase({ ...state, phase: 'challenge' }).phase).toBe('revise');
    expect(advancePhase({ ...state, phase: 'revise' }).phase).toBe('converge');
    expect(advancePhase({ ...state, phase: 'converge' }).phase).toBe('complete');
    expect(advancePhase({ ...state, phase: 'complete' }).phase).toBe('complete');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npm test -- lib/roundtable/__tests__/state.test.ts
```

Expected: FAIL because mutation functions are missing.

- [ ] **Step 3: Implement mutations**

Append to `workspace/frontend/lib/roundtable/state.ts`:

```ts
import type { FactPackItem, RoundtableAgentConfig, RoundtablePhase } from './types';

const nextPhase: Record<RoundtablePhase, RoundtablePhase> = {
  setup: 'initial',
  initial: 'challenge',
  challenge: 'revise',
  revise: 'converge',
  converge: 'complete',
  complete: 'complete',
};

function touch<T extends { updatedAt: string }>(state: T, now = new Date()): T {
  return { ...state, updatedAt: now.toISOString() };
}

export function updateMeetingFields(
  state: RoundtableState,
  fields: Partial<Pick<RoundtableState, 'topic' | 'goal' | 'background' | 'searchScope' | 'outputPreference'>>,
  now = new Date(),
): RoundtableState {
  return touch({ ...state, ...fields }, now);
}

export function addOrUpdateAgent(state: RoundtableState, agent: RoundtableAgentConfig, now = new Date()): RoundtableState {
  const exists = state.agents.some((item) => item.id === agent.id);
  const agents = exists
    ? state.agents.map((item) => (item.id === agent.id ? agent : item))
    : [...state.agents, agent];

  return touch({ ...state, agents }, now);
}

export function addFactPackItem(state: RoundtableState, item: FactPackItem, now = new Date()): RoundtableState {
  return touch({ ...state, factPack: [...state.factPack, item] }, now);
}

export function advancePhase(state: RoundtableState, now = new Date()): RoundtableState {
  return touch({ ...state, phase: nextPhase[state.phase] }, now);
}
```

If TypeScript reports duplicate imports, merge imports at the top of `state.ts` into one import:

```ts
import type { FactPackItem, RoundtableAgentConfig, RoundtableFinalOutput, RoundtablePhase, RoundtableState } from './types';
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- lib/roundtable/__tests__/state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/lib/roundtable/state.ts workspace/frontend/lib/roundtable/__tests__/state.test.ts
git commit -m "feat: add roundtable state mutations"
```

## Task 4: Interaction Extraction

**Files:**
- Create: `workspace/frontend/lib/roundtable/interactions.ts`
- Create: `workspace/frontend/lib/roundtable/__tests__/interactions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `workspace/frontend/lib/roundtable/__tests__/interactions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractInteractionsFromMessage } from '../interactions';

const agents = ['Alpha', 'Beta', 'Gamma'];

describe('extractInteractionsFromMessage', () => {
  it('extracts mention edges', () => {
    const edges = extractInteractionsFromMessage({
      messageId: 'm1',
      senderName: 'Alpha',
      content: '@Beta can you inspect this assumption?',
      phase: 'initial',
      agentNames: agents,
      createdAt: '2026-06-08T00:00:00.000Z',
    });

    expect(edges[0]).toMatchObject({ type: 'mention', fromAgent: 'Alpha', toAgent: 'Beta' });
  });

  it('classifies challenge language near a mention', () => {
    const edges = extractInteractionsFromMessage({
      messageId: 'm2',
      senderName: 'Alpha',
      content: '@Beta I challenge this because the evidence is weak.',
      phase: 'challenge',
      agentNames: agents,
      createdAt: '2026-06-08T00:00:00.000Z',
    });

    expect(edges[0]).toMatchObject({ type: 'challenge', fromAgent: 'Alpha', toAgent: 'Beta' });
  });

  it('detects evidence requests without a target agent', () => {
    const edges = extractInteractionsFromMessage({
      messageId: 'm3',
      senderName: 'Gamma',
      content: 'Evidence request: source needed for adoption speed.',
      phase: 'challenge',
      agentNames: agents,
      createdAt: '2026-06-08T00:00:00.000Z',
    });

    expect(edges[0]).toMatchObject({ type: 'evidence_request', fromAgent: 'Gamma', toAgent: null });
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npm test -- lib/roundtable/__tests__/interactions.test.ts
```

Expected: FAIL because `../interactions` does not exist.

- [ ] **Step 3: Implement extraction**

Create `workspace/frontend/lib/roundtable/interactions.ts`:

```ts
import type { RoundtableInteraction, RoundtableInteractionType, RoundtablePhase } from './types';

interface ExtractInteractionInput {
  messageId: string | null;
  senderName: string;
  content: string;
  phase: RoundtablePhase;
  agentNames: string[];
  createdAt: string;
}

const challengeTerms = ['challenge', '质疑', '反驳', '风险', '证据不足', 'weak evidence'];
const responseTerms = ['response', 'respond', '回应', '接受', '修正', 'revise', 'defend'];
const evidenceTerms = ['evidence request', '补证据', '需要来源', 'source needed', 'need source'];

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function classifyMention(content: string): RoundtableInteractionType {
  if (includesAny(content, challengeTerms)) return 'challenge';
  if (includesAny(content, responseTerms)) return 'response';
  return 'mention';
}

export function extractInteractionsFromMessage(input: ExtractInteractionInput): RoundtableInteraction[] {
  const edges: RoundtableInteraction[] = [];
  const mentionedAgents = input.agentNames.filter((name) => {
    if (name === input.senderName) return false;
    return input.content.includes(`@${name}`);
  });

  for (const target of mentionedAgents) {
    edges.push({
      id: `${input.messageId || input.createdAt}-${input.senderName}-${target}`,
      type: classifyMention(input.content),
      fromAgent: input.senderName,
      toAgent: target,
      messageId: input.messageId,
      phase: input.phase,
      createdAt: input.createdAt,
    });
  }

  if (edges.length === 0 && includesAny(input.content, evidenceTerms)) {
    edges.push({
      id: `${input.messageId || input.createdAt}-${input.senderName}-evidence`,
      type: 'evidence_request',
      fromAgent: input.senderName,
      toAgent: null,
      messageId: input.messageId,
      phase: input.phase,
      createdAt: input.createdAt,
    });
  }

  return edges;
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- lib/roundtable/__tests__/interactions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/lib/roundtable/interactions.ts workspace/frontend/lib/roundtable/__tests__/interactions.test.ts
git commit -m "feat: extract roundtable interactions"
```

## Task 5: Prompt Builders

**Files:**
- Create: `workspace/frontend/lib/roundtable/prompts.ts`

- [ ] **Step 1: Add prompt builder**

Create `workspace/frontend/lib/roundtable/prompts.ts`:

```ts
import type { RoundtableAgentConfig, RoundtablePhase, RoundtableState } from './types';

const phaseInstructions: Record<RoundtablePhase, string> = {
  setup: 'Prepare the roundtable. Do not produce strategy content yet.',
  initial: 'Round 1: give your initial judgment, supporting reasons, opportunities, assumptions, and validation questions.',
  challenge: 'Round 2: challenge another agent or idea. Name the target with @AgentName and request evidence when needed.',
  revise: 'Round 3: respond to challenges, state what changed, what you reject, and what still needs validation.',
  converge: 'Round 4: converge on ideas, support, objections, key risks, consensus, disagreements, validation questions, and next steps.',
  complete: 'The roundtable is complete. Only answer follow-up questions from the user.',
};

function formatFactPack(state: RoundtableState): string {
  if (state.factPack.length === 0) return 'No Fact Pack items have been added. Mark factual claims as assumptions.';
  return state.factPack
    .map((fact, index) => `${index + 1}. ${fact.claim}\n   Source: ${fact.sourceName || 'not provided'} ${fact.sourceUrl || ''}\n   Status: ${fact.sourceStatus}\n   Uncertainty: ${fact.uncertainty || 'none stated'}`)
    .join('\n');
}

export function buildAgentPhasePrompt(state: RoundtableState, agent: RoundtableAgentConfig, transcriptExcerpt: string): string {
  return [
    `You are ${agent.displayName}.`,
    `Role label: ${agent.roleLabel || 'not specified'}.`,
    `Role description: ${agent.roleDescription || 'not specified'}.`,
    `Meeting duty: ${agent.duty || 'participate constructively in the roundtable'}.`,
    '',
    'Private Skill.md for this agent:',
    agent.skillMarkdown || 'No imported skill. Use only the role and meeting duty.',
    '',
    `Discussion topic: ${state.topic}`,
    `Meeting goal: ${state.goal}`,
    `Background: ${state.background || 'none provided'}`,
    '',
    'Shared Fact Pack:',
    formatFactPack(state),
    '',
    'Public transcript excerpt:',
    transcriptExcerpt || 'No transcript yet.',
    '',
    phaseInstructions[state.phase],
    '',
    'Rules: use the shared Fact Pack for factual claims, mark unsupported statements as assumptions, challenge ideas rather than people, and keep your role boundary clear.',
  ].join('\n');
}

export function buildKickoffPrompt(state: RoundtableState): string {
  const enabledAgents = state.agents.filter((agent) => agent.enabled).map((agent) => `@${agent.displayName}`).join(', ');
  return [
    'Roundtable kickoff.',
    `Topic: ${state.topic}`,
    `Goal: ${state.goal}`,
    `Participants: ${enabledAgents}`,
    'Protocol: Round 1 initial positions, Round 2 challenges, Round 3 revisions, Round 4 convergence.',
    'All facts must trace to the shared Fact Pack or be marked as assumptions.',
  ].join('\n');
}

export function buildHumanInterventionPrompt(action: string, detail: string, fromAgent?: string, toAgent?: string): string {
  const routing = fromAgent && toAgent ? ` ${fromAgent} should address @${toAgent}.` : '';
  return `Human intervention: ${action}.${routing}\n${detail}`.trim();
}

export function buildSearchRequestUrl(query: string): string {
  const encoded = encodeURIComponent(query.trim());
  return `https://www.google.com/search?q=${encoded}`;
}
```

- [ ] **Step 2: Run TypeScript build after prompt module**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```powershell
git add workspace/frontend/lib/roundtable/prompts.ts
git commit -m "feat: add roundtable prompt builders"
```

## Task 6: Markdown Export

**Files:**
- Create: `workspace/frontend/lib/roundtable/export.ts`
- Create: `workspace/frontend/lib/roundtable/__tests__/export.test.ts`

- [ ] **Step 1: Write failing export test**

Create `workspace/frontend/lib/roundtable/__tests__/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRoundtableState } from '../state';
import { buildRoundtableMarkdown } from '../export';

describe('buildRoundtableMarkdown', () => {
  it('includes topic, goal, Fact Pack, and final output sections', () => {
    const state = {
      ...createRoundtableState(new Date('2026-06-08T00:00:00.000Z')),
      topic: 'Hospital BU BD opportunities',
      goal: 'Generate bold but evidence-bounded ideas',
      factPack: [{
        id: 'fact-1',
        claim: 'Claims need source status.',
        sourceName: 'User brief',
        sourceUrl: '',
        sourceStatus: 'user_provided' as const,
        uncertainty: '',
        createdBy: 'user',
        createdAt: '2026-06-08T00:00:00.000Z',
      }],
      finalOutput: {
        ideas: 'Idea A',
        supportingReasons: 'Reason A',
        objections: 'Objection A',
        keyRisks: 'Risk A',
        consensus: 'Consensus A',
        disagreements: 'Disagreement A',
        validationQuestions: 'Question A',
        nextSteps: 'Step A',
      },
    };

    const markdown = buildRoundtableMarkdown(state);

    expect(markdown).toContain('# Roundtable Output');
    expect(markdown).toContain('Hospital BU BD opportunities');
    expect(markdown).toContain('Claims need source status.');
    expect(markdown).toContain('## Ideas');
    expect(markdown).toContain('Idea A');
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- lib/roundtable/__tests__/export.test.ts
```

Expected: FAIL because `../export` does not exist.

- [ ] **Step 3: Implement export builder**

Create `workspace/frontend/lib/roundtable/export.ts`:

```ts
import type { RoundtableState } from './types';

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim() || 'Not captured.'}`;
}

export function buildRoundtableMarkdown(state: RoundtableState): string {
  const facts = state.factPack.length === 0
    ? 'No Fact Pack items captured.'
    : state.factPack.map((fact, index) => {
        const source = [fact.sourceName, fact.sourceUrl].filter(Boolean).join(' - ') || 'source not provided';
        return `${index + 1}. ${fact.claim}\n   - Source: ${source}\n   - Status: ${fact.sourceStatus}\n   - Uncertainty: ${fact.uncertainty || 'none stated'}`;
      }).join('\n');

  return [
    '# Roundtable Output',
    '',
    `**Topic:** ${state.topic || 'Not captured.'}`,
    '',
    `**Goal:** ${state.goal || 'Not captured.'}`,
    '',
    section('Fact Pack', facts),
    '',
    section('Ideas', state.finalOutput.ideas),
    '',
    section('Supporting Reasons', state.finalOutput.supportingReasons),
    '',
    section('Objections', state.finalOutput.objections),
    '',
    section('Key Risks', state.finalOutput.keyRisks),
    '',
    section('Consensus', state.finalOutput.consensus),
    '',
    section('Disagreements', state.finalOutput.disagreements),
    '',
    section('Validation Questions', state.finalOutput.validationQuestions),
    '',
    section('Next Steps', state.finalOutput.nextSteps),
  ].join('\n');
}
```

- [ ] **Step 4: Run export tests**

Run:

```powershell
npm test -- lib/roundtable/__tests__/export.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/lib/roundtable/export.ts workspace/frontend/lib/roundtable/__tests__/export.test.ts
git commit -m "feat: add roundtable markdown export"
```

## Task 7: Workspace Settings Serialization

**Files:**
- Create: `workspace/frontend/lib/roundtable/storage.ts`

- [ ] **Step 1: Add storage helpers**

Create `workspace/frontend/lib/roundtable/storage.ts`:

```ts
import { createRoundtableState } from './state';
import type { RoundtableState } from './types';

export const ROUNDTABLE_SETTINGS_KEY = 'roundtableP0';

export function readRoundtableState(settings: Record<string, unknown> | null | undefined): RoundtableState {
  const value = settings?.[ROUNDTABLE_SETTINGS_KEY];
  if (!value || typeof value !== 'object') return createRoundtableState();
  return { ...createRoundtableState(), ...(value as Partial<RoundtableState>) };
}

export function writeRoundtableState(settings: Record<string, unknown> | null | undefined, state: RoundtableState): Record<string, unknown> {
  return {
    ...(settings || {}),
    [ROUNDTABLE_SETTINGS_KEY]: state,
  };
}
```

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```powershell
git add workspace/frontend/lib/roundtable/storage.ts
git commit -m "feat: persist roundtable state in workspace settings"
```

## Task 8: Roundtable View Shell

**Files:**
- Create: `workspace/frontend/components/roundtable/roundtable-view.tsx`
- Modify: `workspace/frontend/components/layout/layout-context.tsx`
- Modify: `workspace/frontend/components/layout/sidebar-content.tsx`
- Modify: `workspace/frontend/components/layout/wrapper.tsx`

- [ ] **Step 1: Create a minimal view shell**

Create `workspace/frontend/components/roundtable/roundtable-view.tsx`:

```tsx
'use client';

import { BrainCircuit } from 'lucide-react';

export function RoundtableView() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <BrainCircuit className="size-4 text-muted-foreground" />
        <div>
          <h1 className="text-[14px] font-semibold leading-tight">Roundtable</h1>
          <p className="text-[12px] text-muted-foreground">P0 strategy discussion workspace</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        Configure a roundtable to begin.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add view mode**

In `workspace/frontend/components/layout/layout-context.tsx`, update `ViewMode`:

```ts
export type ViewMode = 'threads' | 'roundtable' | 'files' | 'knowledge' | 'browser' | 'tasks' | 'routines' | 'inbox' | 'connect' | 'skills';
```

- [ ] **Step 3: Add sidebar nav item**

In `workspace/frontend/components/layout/sidebar-content.tsx`, import `BrainCircuit` from `lucide-react` and add:

```tsx
<NavButton active={viewMode === 'roundtable'} icon={<BrainCircuit className="size-[15px]" />} label="Roundtable" onClick={() => setViewMode('roundtable')} />
```

Place it in the Collaboration section after Threads.

- [ ] **Step 4: Render the view**

In `workspace/frontend/components/layout/wrapper.tsx`, import:

```ts
import { RoundtableView } from '@/components/roundtable/roundtable-view';
```

Render `RoundtableView` in both mobile full-screen handling and desktop right pane:

```tsx
{viewMode === 'roundtable' && <RoundtableView />}
```

Also exclude `roundtable` from the desktop middle pane condition so it uses the full main pane.

- [ ] **Step 5: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds and `roundtable` is accepted as a `ViewMode`.

- [ ] **Step 6: Commit**

```powershell
git add workspace/frontend/components/roundtable/roundtable-view.tsx workspace/frontend/components/layout/layout-context.tsx workspace/frontend/components/layout/sidebar-content.tsx workspace/frontend/components/layout/wrapper.tsx
git commit -m "feat: add roundtable workspace view"
```

## Task 9: Setup Panel And Agent Roster

**Files:**
- Create: `workspace/frontend/components/roundtable/roundtable-setup-panel.tsx`
- Create: `workspace/frontend/components/roundtable/roundtable-agent-roster.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`

- [ ] **Step 1: Add setup panel**

Create `workspace/frontend/components/roundtable/roundtable-setup-panel.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RoundtableState } from '@/lib/roundtable/types';

interface RoundtableSetupPanelProps {
  state: RoundtableState;
  onChange: (patch: Partial<Pick<RoundtableState, 'topic' | 'goal' | 'background' | 'searchScope' | 'outputPreference'>>) => void;
  onStart: () => void;
  canStart: boolean;
}

export function RoundtableSetupPanel({ state, onChange, onStart, canStart }: RoundtableSetupPanelProps) {
  return (
    <section className="flex min-h-0 flex-col gap-3 border-r border-border p-3">
      <div className="space-y-1">
        <Label>Topic</Label>
        <Input value={state.topic} onChange={(event) => onChange({ topic: event.target.value })} placeholder="What should the roundtable discuss?" />
      </div>
      <div className="space-y-1">
        <Label>Meeting goal</Label>
        <Textarea value={state.goal} onChange={(event) => onChange({ goal: event.target.value })} placeholder="What should the discussion produce?" />
      </div>
      <div className="space-y-1">
        <Label>Background</Label>
        <Textarea value={state.background} onChange={(event) => onChange({ background: event.target.value })} placeholder="Optional context for all agents" />
      </div>
      <div className="space-y-1">
        <Label>Search scope</Label>
        <Input value={state.searchScope} onChange={(event) => onChange({ searchScope: event.target.value })} placeholder="Public sources, market, policy, clinical, company" />
      </div>
      <div className="space-y-1">
        <Label>Output preference</Label>
        <Input value={state.outputPreference} onChange={(event) => onChange({ outputPreference: event.target.value })} />
      </div>
      <Button onClick={onStart} disabled={!canStart}>Start Roundtable</Button>
    </section>
  );
}
```

- [ ] **Step 2: Add agent roster**

Create `workspace/frontend/components/roundtable/roundtable-agent-roster.tsx`:

```tsx
'use client';

import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { RoundtableAgentConfig } from '@/lib/roundtable/types';
import type { WorkspaceAgent } from '@/lib/types';

interface RoundtableAgentRosterProps {
  workspaceAgents: WorkspaceAgent[];
  agents: RoundtableAgentConfig[];
  onChangeAgent: (agent: RoundtableAgentConfig) => void;
}

function toRoundtableAgent(agent: WorkspaceAgent): RoundtableAgentConfig {
  return {
    id: agent.agentName,
    workspaceAgentName: agent.agentName,
    displayName: agent.agentName,
    avatarSeed: agent.agentName,
    avatarUrl: null,
    roleLabel: agent.role || 'Roundtable agent',
    roleDescription: agent.description || '',
    duty: '',
    skillMarkdown: '',
    enabled: true,
  };
}

export function RoundtableAgentRoster({ workspaceAgents, agents, onChangeAgent }: RoundtableAgentRosterProps) {
  const configs = workspaceAgents.map((workspaceAgent) =>
    agents.find((agent) => agent.workspaceAgentName === workspaceAgent.agentName) || toRoundtableAgent(workspaceAgent)
  );

  return (
    <section className="min-h-0 space-y-3 overflow-y-auto border-t border-border p-3">
      <div>
        <h2 className="text-[13px] font-semibold">Agents</h2>
        <p className="text-[12px] text-muted-foreground">Enable agents and bind role-specific Skill.md text.</p>
      </div>
      {configs.map((agent) => (
        <div key={agent.id} className="space-y-2 rounded-lg border border-border p-2">
          <div className="flex items-center gap-2">
            <AgentAvatar name={agent.avatarSeed} size={28} status="online" />
            <Input value={agent.displayName} onChange={(event) => onChangeAgent({ ...agent, displayName: event.target.value })} />
            <Switch checked={agent.enabled} onCheckedChange={(enabled) => onChangeAgent({ ...agent, enabled })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Role label</Label>
              <Input value={agent.roleLabel} onChange={(event) => onChangeAgent({ ...agent, roleLabel: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Duty</Label>
              <Input value={agent.duty} onChange={(event) => onChangeAgent({ ...agent, duty: event.target.value })} />
            </div>
          </div>
          <Textarea value={agent.roleDescription} onChange={(event) => onChangeAgent({ ...agent, roleDescription: event.target.value })} placeholder="Role description" />
          <Textarea value={agent.skillMarkdown} onChange={(event) => onChangeAgent({ ...agent, skillMarkdown: event.target.value })} placeholder="Paste imported SKILL.md for this agent" />
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 3: Compose setup in view**

In `roundtable-view.tsx`, use `useWorkspace`, `createRoundtableState`, `updateMeetingFields`, and `addOrUpdateAgent`. Keep state local first:

```tsx
const { agents: workspaceAgents } = useWorkspace();
const [state, setState] = useState(() => createRoundtableState());
const enabledCount = state.agents.filter((agent) => agent.enabled).length;
```

Render `RoundtableSetupPanel` and `RoundtableAgentRoster` in the left pane.

- [ ] **Step 4: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/components/roundtable/roundtable-view.tsx workspace/frontend/components/roundtable/roundtable-setup-panel.tsx workspace/frontend/components/roundtable/roundtable-agent-roster.tsx
git commit -m "feat: configure roundtable agents"
```

## Task 10: Fact Pack Panel

**Files:**
- Create: `workspace/frontend/components/roundtable/fact-pack-panel.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`

- [ ] **Step 1: Create Fact Pack panel**

Create `workspace/frontend/components/roundtable/fact-pack-panel.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { ExternalLink, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FactPackItem } from '@/lib/roundtable/types';
import { buildSearchRequestUrl } from '@/lib/roundtable/prompts';

interface FactPackPanelProps {
  facts: FactPackItem[];
  onAddFact: (fact: FactPackItem) => void;
  onUploadFile: (file: File) => Promise<void>;
  onOpenSearch: (url: string) => Promise<void>;
}

export function FactPackPanel({ facts, onAddFact, onUploadFile, onOpenSearch }: FactPackPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [claim, setClaim] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [uncertainty, setUncertainty] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const addFact = () => {
    if (!claim.trim()) return;
    onAddFact({
      id: `fact-${Date.now()}`,
      claim: claim.trim(),
      sourceName: sourceName.trim(),
      sourceUrl: sourceUrl.trim(),
      sourceStatus: sourceUrl.trim() ? 'sourced' : 'user_provided',
      uncertainty: uncertainty.trim(),
      createdBy: 'user',
      createdAt: new Date().toISOString(),
    });
    setClaim('');
    setSourceName('');
    setSourceUrl('');
    setUncertainty('');
  };

  return (
    <section className="flex min-h-0 flex-col gap-3 border-l border-border p-3">
      <div>
        <h2 className="text-[13px] font-semibold">Fact Pack</h2>
        <p className="text-[12px] text-muted-foreground">Only promoted facts become shared evidence.</p>
      </div>
      <div className="space-y-2">
        <Textarea value={claim} onChange={(event) => setClaim(event.target.value)} placeholder="Claim or source note" />
        <Input value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Source name" />
        <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Source URL" />
        <Input value={uncertainty} onChange={(event) => setUncertainty(event.target.value)} placeholder="Uncertainty or caveat" />
        <Button onClick={addFact} disabled={!claim.trim()}>Add Fact</Button>
      </div>
      <div className="flex gap-2">
        <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search query" />
        <Button variant="outline" size="icon" onClick={() => onOpenSearch(buildSearchRequestUrl(searchQuery))} disabled={!searchQuery.trim()}>
          <ExternalLink className="size-4" />
        </Button>
      </div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void onUploadFile(file);
        event.currentTarget.value = '';
      }} />
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        <Upload className="mr-2 size-4" />
        Upload File
      </Button>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {facts.map((fact) => (
          <div key={fact.id} className="rounded-lg border border-border p-2 text-[12px]">
            <div className="font-medium text-foreground">{fact.claim}</div>
            <div className="text-muted-foreground">{fact.sourceName || 'source not provided'} · {fact.sourceStatus}</div>
            {fact.uncertainty && <div className="text-amber-600">{fact.uncertainty}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire uploads and search**

In `roundtable-view.tsx`, use `uploadFile`, `openBrowserTab`, `setSelectedBrowserTabId`, and `setViewMode` through existing contexts:

```tsx
const { uploadFile, openBrowserTab } = useWorkspace();
const { setViewMode } = useLayout();

const handleUploadFile = async (file: File) => {
  const uploaded = await uploadFile(file);
  setState((current) => addFactPackItem(current, {
    id: `file-${uploaded.id}`,
    claim: `Uploaded file: ${uploaded.filename}`,
    sourceName: uploaded.filename,
    sourceUrl: '',
    sourceStatus: 'user_provided',
    uncertainty: 'File content is uploaded but not automatically summarized in P0.',
    createdBy: 'user',
    createdAt: new Date().toISOString(),
  }));
};

const handleOpenSearch = async (url: string) => {
  await openBrowserTab(url);
  setViewMode('browser');
};
```

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add workspace/frontend/components/roundtable/fact-pack-panel.tsx workspace/frontend/components/roundtable/roundtable-view.tsx
git commit -m "feat: add roundtable fact pack panel"
```

## Task 11: Phase Rail And Protocol Actions

**Files:**
- Create: `workspace/frontend/components/roundtable/phase-rail.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`

- [ ] **Step 1: Create phase rail**

Create `workspace/frontend/components/roundtable/phase-rail.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import type { RoundtablePhase } from '@/lib/roundtable/types';

const labels: Record<RoundtablePhase, string> = {
  setup: 'Setup',
  initial: 'Round 1 Initial',
  challenge: 'Round 2 Challenge',
  revise: 'Round 3 Revise',
  converge: 'Round 4 Converge',
  complete: 'Complete',
};

interface PhaseRailProps {
  phase: RoundtablePhase;
  isPaused: boolean;
  onAdvance: () => void;
  onPauseToggle: () => void;
}

export function PhaseRail({ phase, isPaused, onAdvance, onPauseToggle }: PhaseRailProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {Object.entries(labels).map(([key, label]) => (
        <div key={key} className={key === phase ? 'text-[12px] font-semibold text-primary' : 'text-[12px] text-muted-foreground'}>
          {label}
        </div>
      ))}
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={onPauseToggle}>{isPaused ? 'Resume' : 'Pause'}</Button>
      <Button size="sm" onClick={onAdvance} disabled={phase === 'complete' || isPaused}>Advance</Button>
    </div>
  );
}
```

- [ ] **Step 2: Wire phase advance**

In `roundtable-view.tsx`, call `advancePhase` and send a phase prompt with `workspaceApi.sendMessage` if a session exists.

```tsx
const handleAdvancePhase = async () => {
  const next = advancePhase(state);
  setState(next);
  if (!next.sessionId) return;
  const enabledAgents = next.agents.filter((agent) => agent.enabled);
  for (const agent of enabledAgents) {
    await workspaceApi.sendMessage(next.sessionId, buildAgentPhasePrompt(next, agent, ''), currentUser.name || 'user', [agent.workspaceAgentName], currentUser.id);
  }
};
```

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add workspace/frontend/components/roundtable/phase-rail.tsx workspace/frontend/components/roundtable/roundtable-view.tsx
git commit -m "feat: control roundtable phases"
```

## Task 12: Transcript Polling And Interaction Map

**Files:**
- Create: `workspace/frontend/components/roundtable/roundtable-transcript.tsx`
- Create: `workspace/frontend/components/roundtable/interaction-map.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`

- [ ] **Step 1: Add transcript component**

Create `workspace/frontend/components/roundtable/roundtable-transcript.tsx`:

```tsx
'use client';

import type { WorkspaceMessage } from '@/lib/types';

export function RoundtableTranscript({ messages }: { messages: WorkspaceMessage[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {messages.length === 0 ? (
        <div className="text-sm text-muted-foreground">Transcript will appear after the roundtable starts.</div>
      ) : (
        <div className="space-y-2">
          {messages.map((message) => (
            <div key={message.messageId} className="rounded-lg border border-border p-2">
              <div className="text-[12px] font-medium">{message.senderName}</div>
              <div className="whitespace-pre-wrap text-[13px] leading-5">{message.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add interaction map**

Create `workspace/frontend/components/roundtable/interaction-map.tsx`:

```tsx
'use client';

import { AgentAvatar } from '@/components/agents/agent-avatar';
import type { RoundtableAgentConfig, RoundtableInteraction } from '@/lib/roundtable/types';

interface InteractionMapProps {
  agents: RoundtableAgentConfig[];
  interactions: RoundtableInteraction[];
}

export function InteractionMap({ agents, interactions }: InteractionMapProps) {
  const latest = interactions.slice(-4);
  return (
    <div className="border-b border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        {agents.filter((agent) => agent.enabled).map((agent) => (
          <div key={agent.id} className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
            <AgentAvatar name={agent.avatarSeed} size={22} status="online" />
            <span className="text-[12px]">{agent.displayName}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {latest.length === 0 ? (
          <span className="text-[12px] text-muted-foreground">No interactions detected yet.</span>
        ) : latest.map((edge) => (
          <span key={edge.id} className="rounded-md bg-muted px-2 py-1 text-[12px]">
            {edge.fromAgent} {edge.type.replace('_', ' ')} {edge.toAgent || 'Fact Pack'}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Poll messages in the view**

In `roundtable-view.tsx`, add:

```tsx
const [messages, setMessages] = useState<WorkspaceMessage[]>([]);

useEffect(() => {
  if (!state.sessionId) return;
  let cancelled = false;
  const poll = async () => {
    const result = await workspaceApi.pollMessages(state.sessionId!);
    if (cancelled) return;
    setMessages(result.messages);
    const displayNames = state.agents.map((agent) => agent.displayName);
    const edges = result.messages.flatMap((message) => extractInteractionsFromMessage({
      messageId: message.messageId,
      senderName: message.senderName,
      content: message.content,
      phase: state.phase,
      agentNames: displayNames,
      createdAt: message.createdAt || new Date().toISOString(),
    }));
    setState((current) => ({ ...current, interactions: edges, updatedAt: new Date().toISOString() }));
  };
  void poll();
  const interval = window.setInterval(() => void poll(), 5000);
  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}, [state.sessionId, state.phase, state.agents]);
```

- [ ] **Step 4: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/components/roundtable/roundtable-transcript.tsx workspace/frontend/components/roundtable/interaction-map.tsx workspace/frontend/components/roundtable/roundtable-view.tsx
git commit -m "feat: show roundtable transcript interactions"
```

## Task 13: Human Intervention Bar

**Files:**
- Create: `workspace/frontend/components/roundtable/human-intervention-bar.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`

- [ ] **Step 1: Add intervention component**

Create `workspace/frontend/components/roundtable/human-intervention-bar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface HumanInterventionBarProps {
  disabled: boolean;
  onSend: (action: string, detail: string) => Promise<void>;
}

export function HumanInterventionBar({ disabled, onSend }: HumanInterventionBarProps) {
  const [detail, setDetail] = useState('');
  const send = async (action: string) => {
    if (!detail.trim()) return;
    await onSend(action, detail.trim());
    setDetail('');
  };

  return (
    <div className="flex items-center gap-2 border-t border-border p-2">
      <Input value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Intervene, request evidence, or ask an agent to respond" disabled={disabled} />
      <Button variant="outline" disabled={disabled || !detail.trim()} onClick={() => send('add context')}>Context</Button>
      <Button variant="outline" disabled={disabled || !detail.trim()} onClick={() => send('request evidence')}>Evidence</Button>
      <Button disabled={disabled || !detail.trim()} onClick={() => send('direct instruction')}>Send</Button>
    </div>
  );
}
```

- [ ] **Step 2: Wire to channel**

In `roundtable-view.tsx`, add:

```tsx
const handleIntervention = async (action: string, detail: string) => {
  if (!state.sessionId) return;
  await workspaceApi.sendMessage(
    state.sessionId,
    buildHumanInterventionPrompt(action, detail),
    currentUser.name || 'user',
    undefined,
    undefined,
    currentUser.id,
  );
};
```

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add workspace/frontend/components/roundtable/human-intervention-bar.tsx workspace/frontend/components/roundtable/roundtable-view.tsx
git commit -m "feat: add roundtable human interventions"
```

## Task 14: Final Output And Markdown Export UI

**Files:**
- Create: `workspace/frontend/components/roundtable/final-output-panel.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`

- [ ] **Step 1: Add final output panel**

Create `workspace/frontend/components/roundtable/final-output-panel.tsx`:

```tsx
'use client';

import { Download, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildRoundtableMarkdown } from '@/lib/roundtable/export';
import type { RoundtableFinalOutput, RoundtableState } from '@/lib/roundtable/types';

interface FinalOutputPanelProps {
  state: RoundtableState;
  onChange: (output: RoundtableFinalOutput) => void;
}

export function FinalOutputPanel({ state, onChange }: FinalOutputPanelProps) {
  const markdown = buildRoundtableMarkdown(state);
  const update = (key: keyof RoundtableFinalOutput, value: string) => onChange({ ...state.finalOutput, [key]: value });

  const download = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'roundtable-output.md';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-2 border-t border-border p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Final Output</h2>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(markdown)}>
          <Copy className="mr-1 size-3" />
          Copy
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="mr-1 size-3" />
          Download
        </Button>
      </div>
      {[
        ['ideas', 'Ideas'],
        ['supportingReasons', 'Supporting reasons'],
        ['objections', 'Objections'],
        ['keyRisks', 'Key risks'],
        ['consensus', 'Consensus'],
        ['disagreements', 'Disagreements'],
        ['validationQuestions', 'Validation questions'],
        ['nextSteps', 'Next steps'],
      ].map(([key, label]) => (
        <div key={key} className="space-y-1">
          <Label>{label}</Label>
          <Textarea value={state.finalOutput[key as keyof RoundtableFinalOutput]} onChange={(event) => update(key as keyof RoundtableFinalOutput, event.target.value)} />
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Wire final output state**

In `roundtable-view.tsx`, render `FinalOutputPanel` in the right rail and update state:

```tsx
<FinalOutputPanel
  state={state}
  onChange={(finalOutput) => setState((current) => ({ ...current, finalOutput, updatedAt: new Date().toISOString() }))}
/>
```

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add workspace/frontend/components/roundtable/final-output-panel.tsx workspace/frontend/components/roundtable/roundtable-view.tsx
git commit -m "feat: export roundtable markdown"
```

## Task 15: Persistence And Start Roundtable

**Files:**
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`

- [ ] **Step 1: Load and save workspace settings**

In `roundtable-view.tsx`, use `workspace`, `refreshWorkspace`, and `workspaceApi.updateWorkspace`:

```tsx
useEffect(() => {
  if (!workspace) return;
  setState(readRoundtableState(workspace.settings));
}, [workspace?.workspaceId]);

const persistState = async (next: RoundtableState) => {
  setState(next);
  if (!workspace) return;
  await workspaceApi.updateWorkspace({ settings: writeRoundtableState(workspace.settings, next) });
  await refreshWorkspace();
};
```

- [ ] **Step 2: Start roundtable**

Add:

```tsx
const handleStartRoundtable = async () => {
  const enabledAgents = state.agents.filter((agent) => agent.enabled);
  if (!state.topic.trim() || !state.goal.trim() || enabledAgents.length < 2) return;
  const session = await createSession({
    title: `Roundtable: ${state.topic.slice(0, 60)}`,
    participants: enabledAgents.map((agent) => agent.workspaceAgentName),
  });
  const next = { ...state, sessionId: session.sessionId, phase: 'initial' as const, updatedAt: new Date().toISOString() };
  await persistState(next);
  await workspaceApi.sendMessage(session.sessionId, buildKickoffPrompt(next), currentUser.name || 'user', enabledAgents.map((agent) => agent.workspaceAgentName), undefined, currentUser.id);
};
```

- [ ] **Step 3: Replace local `setState` calls where persistence matters**

For meeting field changes, agent updates, Fact Pack additions, phase changes, and final output changes, call `persistState(next)` after local changes that should survive reloads. Keep transcript polling changes local to avoid excessive workspace PATCH calls.

- [ ] **Step 4: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/components/roundtable/roundtable-view.tsx
git commit -m "feat: start and persist roundtable sessions"
```

## Task 16: Responsive Polish And Empty States

**Files:**
- Modify: `workspace/frontend/components/roundtable/roundtable-view.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-setup-panel.tsx`
- Modify: `workspace/frontend/components/roundtable/roundtable-agent-roster.tsx`
- Modify: `workspace/frontend/components/roundtable/fact-pack-panel.tsx`
- Modify: `workspace/frontend/components/roundtable/final-output-panel.tsx`

- [ ] **Step 1: Apply desktop grid**

Use this structure in `RoundtableView`:

```tsx
<div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)_360px] bg-background">
  <div className="min-h-0 overflow-hidden">setup and agents</div>
  <div className="flex min-h-0 flex-col">phase rail, interaction map, transcript, intervention</div>
  <div className="min-h-0 overflow-y-auto">fact pack and final output</div>
</div>
```

- [ ] **Step 2: Apply mobile stack**

Use Tailwind responsive classes:

```tsx
<div className="grid h-full min-h-0 grid-cols-1 bg-background lg:grid-cols-[320px_minmax(0,1fr)_360px]">
```

Ensure each pane has `min-h-0` and scrolls internally.

- [ ] **Step 3: Confirm no text overflow**

Check button labels and long source URLs. Add `truncate`, `break-words`, or `whitespace-pre-wrap` where needed.

- [ ] **Step 4: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add workspace/frontend/components/roundtable
git commit -m "style: polish roundtable responsive layout"
```

## Task 17: Verification

**Files:**
- No source edits expected unless verification exposes a confirmed defect.

- [ ] **Step 1: Run unit tests**

Run:

```powershell
cd 'C:\Vibe Coding Project\AgentHive\openagents\workspace\frontend'
npm test
```

Expected: all roundtable utility tests pass.

- [ ] **Step 2: Run production build**

Run:

```powershell
npm run build
```

Expected: Next.js build succeeds.

- [ ] **Step 3: Start dev server**

Run:

```powershell
npm run dev
```

Expected: local dev server starts on `http://localhost:3001`.

- [ ] **Step 4: Browser smoke test**

Open `http://localhost:3001`, enter a workspace, and verify:

- sidebar has `Roundtable`,
- the Roundtable view opens,
- topic and goal inputs accept text,
- at least two agents can be enabled,
- `SKILL.md` text can be pasted into one agent,
- a Fact Pack item can be added,
- file upload creates a Fact Pack item,
- search opens a browser tab,
- `Start Roundtable` creates a channel,
- `Advance` moves phases,
- transcript polling shows messages,
- interaction chips appear for messages with `@AgentName`,
- intervention sends a message,
- Markdown copy and download work.

- [ ] **Step 5: Final git check**

Run:

```powershell
git status --short
```

Expected: only intentional files are modified; generated or local-only directories such as `.codegraph/` and `.superpowers/` are not added unless the user explicitly asks.

## Self-Review

- Spec coverage: each P0 requirement maps to a file or component in this plan.
- Placeholder scan: the plan contains no unresolved marker text or empty implementation steps.
- Type consistency: `RoundtableState`, `RoundtableAgentConfig`, `FactPackItem`, `RoundtableInteraction`, and `RoundtableFinalOutput` are defined before use.
- Scope check: the plan stays on frontend P0 and does not add backend orchestration.
- Risk handling: prompt-level isolation, search extraction, file summarization, and connected-agent behavior are represented as explicit P0 limitations.
