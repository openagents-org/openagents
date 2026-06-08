# Roundtable P0 Design Spec

**Status:** Drafted for user review after choosing implementation depth A.

**Source requirements:** `C:/Vibe Coding Project/AgentHive/multi_agent_roundtable_prd_v0.2.md`

**Implementation depth:** A - build a dedicated frontend roundtable workbench and reuse existing OpenAgents workspace events, sessions, files, knowledge, browser, and agent APIs. Do not build the full backend roundtable orchestrator in P0.

## Product Design Brief

Build a P0 multi-agent business strategy roundtable inside the existing OpenAgents workspace product.

The feature should let a user configure multiple participating agents, import `SKILL.md` text per agent, assemble a Fact Pack, run a four-phase semi-autonomous discussion, see agent-to-agent interactions, intervene during the discussion, and export a structured Markdown output.

The visual source is the existing OpenAgents workspace UI: sidebar navigation, bordered work panes, compact typography, Lucide icons, existing `AgentAvatar`, `Button`, `Input`, `Textarea`, `Switch`, `ScrollArea`, and dialog patterns. The first screen must be the usable roundtable workspace, not a landing page.

Interactivity level is full P0 workbench interactivity for configuration, phase control, transcript polling, human intervention, and Markdown export. Runtime agent autonomy is limited by existing backend capabilities and is implemented through existing channel messages and events.

## Goals

- Add a first-class `Roundtable` view to the workspace.
- Support user-defined roundtable agent profiles without fixed hardcoded famous roles.
- Let each roundtable profile hold name, avatar seed or uploaded avatar reference, role label, role description, meeting duty, enabled state, and imported `SKILL.md` content.
- Support a shared Fact Pack with user background, uploaded files, search requests, source notes, uncertainty notes, and evidence requests.
- Run a four-phase protocol:
  - Round 1: Initial positions.
  - Round 2: Agent challenges.
  - Round 3: Revised positions.
  - Round 4: Convergence summary.
- Show current phase, active speaker, `@mention` relationships, challenge relationships, response relationships, transcript, Fact Pack status, and final output.
- Let the human pause, resume, add context, request evidence, ask one agent to answer, ask one agent to challenge another, add another round, stop, and export.
- Produce a Markdown export containing ideas, supporting reasons, objections, risks, consensus, disagreement, open questions, and next steps.

## Non-Goals

- No new backend roundtable orchestrator in P0.
- No OS-level or security sandbox isolation.
- No automatic Skill generation.
- No fixed built-in Musk/Bezos/Jobs/etc. product roles.
- No PowerPoint, Word, Feishu, enterprise permission, or data-security productization.
- No complex character animation.
- No second-level research-agent team.
- No claim that private persona isolation is security-grade. P0 provides UI-level and prompt-construction isolation with explicit limitations.

## Key Product Decisions

### 1. New Workspace View

Add a new `roundtable` view rather than overloading Threads. The roundtable view can create and use a normal OpenAgents channel under the hood, but the user experiences a dedicated meeting workspace with setup, Fact Pack, protocol, interactions, and final output.

### 2. Reuse Existing Runtime Surface

P0 reuses:

- `WorkspaceAgent` data from discovery for available agents.
- `createSession` / `createChannel` for the discussion channel.
- `workspaceApi.sendMessage` for human instructions and phase prompts.
- `workspaceApi.pollMessages` for transcript updates.
- `workspaceApi.uploadFile` for uploaded materials.
- `createKnowledge` / `updateKnowledge` for optional Fact Pack persistence.
- Browser tab APIs for search workflow support.
- Existing UI primitives and `AgentAvatar`.

### 3. P0 Isolation Contract

The UI stores each configured roundtable agent separately and builds per-agent prompts from only:

- that agent's role profile,
- that agent's imported `SKILL.md`,
- the shared topic and meeting goal,
- the shared Fact Pack,
- the public group transcript,
- the current phase instruction,
- human interventions addressed to that agent.

Because P0 does not add backend private prompt routing, isolation is a prompt and UX contract rather than a verified runtime guarantee. If existing connected agents cannot consume direct roundtable events, P0 falls back to channel-visible `@Agent` prompts and marks this limitation in the UI copy.

### 4. Fact Pack Contract

Fact Pack items are structured records with source and uncertainty metadata. Search results must be promoted into the Fact Pack before they become shared evidence. P0 supports search by opening or navigating a workspace browser tab to the requested search URL, then requiring the user or Fact Pack Keeper to save source notes into the Fact Pack. Automated web extraction is not part of depth A unless an existing backend capability is already available.

### 5. Semi-Autonomous Control

The frontend protocol controller advances phases and emits phase prompts. It does not synthesize final strategy content itself except for local Markdown assembly from recorded transcript, Fact Pack items, and user-entered structured summary fields.

The human remains in control of phase advancement. Auto-advance can be available as a toggle, but the default is manual phase progression to keep P0 predictable for internal use.

## User Flow

### 1. Enter Roundtable

The sidebar shows a `Roundtable` nav item when the workspace has at least one agent. Selecting it opens the roundtable workbench.

If no roundtable draft exists, the workbench starts with a setup-first state. If a draft exists in workspace settings or local storage, the workbench restores it.

### 2. Configure Meeting

The user enters:

- discussion topic,
- meeting goal,
- optional background,
- optional time limit,
- output preference.

The user selects existing workspace agents and adds roundtable-specific fields:

- display name override,
- avatar seed or uploaded avatar reference,
- role label,
- role description,
- duty,
- enabled state,
- imported `SKILL.md` text.

### 3. Prepare Fact Pack

The user can:

- add background facts manually,
- upload files through existing file upload,
- add source notes,
- add uncertainty notes,
- open a search request in the browser,
- save evidence requests raised during discussion.

Every Fact Pack item has a source status:

- `sourced`,
- `user_provided`,
- `inferred`,
- `unverified`.

### 4. Start Roundtable

Starting a roundtable creates or resumes a workspace channel with the selected participants. The controller emits a kickoff message that explains the topic, goal, phase protocol, Fact Pack boundary, and agent-specific participation rules.

### 5. Run Four Phases

The phase rail shows current phase, progress, and primary action.

- Round 1 asks each enabled agent for initial positions.
- Round 2 asks enabled agents to challenge specific other agents or ideas.
- Round 3 asks challenged agents to revise or defend their views.
- Round 4 asks for convergence and structured output.

The transcript shows normal conversation. A side interaction map highlights active speakers and recent relationships:

- mention,
- challenge,
- response,
- evidence request.

### 6. Human Intervention

The human intervention bar supports:

- pause or resume,
- add context,
- request evidence,
- ask agent to answer,
- ask agent A to challenge agent B,
- add round,
- stop and summarize.

Interventions are sent as structured channel messages and appended to the local roundtable event log.

### 7. Final Output And Export

The final output panel compiles:

- ideas,
- supporting reasons,
- objections,
- key risks,
- consensus,
- disagreement,
- open validation questions,
- recommended next steps.

The user can copy or download Markdown.

## Information Architecture

Desktop layout uses three work zones inside the existing app frame:

- Left setup rail: meeting fields, agent roster, phase controls.
- Center discussion stage: interaction map and transcript.
- Right evidence/output rail: Fact Pack, evidence requests, final Markdown.

Mobile layout uses tabs:

- Setup,
- Discussion,
- Facts,
- Output.

No nested cards are required. Use bounded panes and compact repeated rows consistent with the existing workspace UI.

## Data Model

### Roundtable State

```ts
type RoundtablePhase = 'setup' | 'initial' | 'challenge' | 'revise' | 'converge' | 'complete';

interface RoundtableState {
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

### Agent Profile

```ts
interface RoundtableAgentConfig {
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
```

### Fact Pack Item

```ts
type FactSourceStatus = 'sourced' | 'user_provided' | 'inferred' | 'unverified';

interface FactPackItem {
  id: string;
  claim: string;
  sourceName: string;
  sourceUrl: string;
  sourceStatus: FactSourceStatus;
  uncertainty: string;
  createdBy: string;
  createdAt: string;
}
```

### Interaction

```ts
type RoundtableInteractionType = 'mention' | 'challenge' | 'response' | 'evidence_request';

interface RoundtableInteraction {
  id: string;
  type: RoundtableInteractionType;
  fromAgent: string;
  toAgent: string | null;
  messageId: string | null;
  phase: RoundtablePhase;
  createdAt: string;
}
```

## Prompt Construction

Each phase prompt should be short, explicit, and auditable.

Per-agent prompt sections:

- identity: display name, role label, role description, duty,
- private skill: imported `SKILL.md`,
- shared facts: Fact Pack items,
- transcript excerpt,
- phase instruction,
- response format.

Phase outputs should request structured headings, not hidden chain-of-thought.

The prompt must state:

- only use the shared Fact Pack for factual claims,
- mark unsupported claims as assumptions,
- request evidence when needed,
- challenge ideas rather than personalities,
- keep role boundaries clear.

## Interaction Extraction

P0 extracts interaction signals from visible messages using deterministic rules:

- `@AgentName` creates a mention edge.
- Words such as `challenge`, `反驳`, `质疑`, `风险`, `证据不足` near an `@AgentName` create a challenge edge.
- Words such as `回应`, `response`, `accept`, `revise`, `修正` near an `@AgentName` create a response edge.
- `evidence request`, `补证据`, `需要来源`, `source needed` creates an evidence request.

These rules are heuristics and are shown as UI-level interaction detection, not as a factual claim about intent.

## Error Handling

- If no agents are connected, show a setup message and a button to open Connect Agent.
- If fewer than two agents are enabled, allow setup but disable `Start Roundtable`.
- If a channel cannot be created, keep the draft and show a toast error.
- If file upload fails, keep the manual Fact Pack entry form usable.
- If browser search cannot open, show the query and let the user copy it.
- If messages cannot be polled, keep local state and show a retry action.
- If Markdown export has no final output, export the topic, goal, Fact Pack, transcript summary fields, and a clear note that convergence has not been completed.

## Acceptance Criteria

- Sidebar includes `Roundtable` and opens a dedicated view.
- User can enter topic and goal.
- User can configure multiple agents and enable or disable them.
- User can import `SKILL.md` text into a specific agent profile.
- User can add Fact Pack items with source status and uncertainty.
- User can upload files from the roundtable view using existing file upload.
- User can open a search request in the workspace browser workflow.
- User can start a roundtable channel with selected participants.
- UI shows current phase and lets user advance through the four phases.
- UI shows agent avatars and recent interaction relationships.
- User can pause, resume, intervene, request evidence, and stop.
- Final panel can assemble and copy or download Markdown.
- No hardcoded famous-role dependency exists in the product logic.
- P0 limitations around prompt-level isolation and search capture are visible in the spec and implementation notes.

## Open Risks To Validate During Implementation

- Existing connected agents may not respond to direct roundtable-specific events. The fallback is channel-visible `@Agent` prompts.
- Existing workspace file upload stores files but may not automatically summarize them. The fallback is user-entered Fact Pack notes.
- Existing browser tab APIs support search navigation, but automatic extraction into Fact Pack is not guaranteed.
- The current frontend lacks a formal test runner. The implementation plan adds focused unit tests for pure roundtable utilities and uses `next build` plus browser smoke testing for UI.

## Self-Review

- Placeholder scan: no placeholder markers remain.
- Scope check: this is one frontend-first P0 feature with no backend orchestrator.
- Consistency check: the chosen architecture matches implementation depth A and the PRD's P0 non-goals.
- Ambiguity check: runtime isolation and automated search extraction are explicitly limited instead of implied.
