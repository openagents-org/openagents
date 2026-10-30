# Humans + Agents: the Collaboration OS

Implementation roadmap for the OpenAgents Workspace vision in the
"Humans + Agents" deck (`bai/slides/openagents-talk-0429/humans-agents.html`,
slides `ha-*`). The deck's promise, in one line: *people and agents are
members of the same workspace, work is routed with @, agents act in the open,
humans approve at the gates that matter, and every action is attributable.*

This document maps each slide to what the product already does, what is
missing, and the order we are building it in. Branch: `feat/humans-agents-collab-os`. This doc: `workspace/docs/humans-agents-collab-os.md`.

**2026-09-30:** the product roadmap (`bai/openagents/roadmap.md`) was
resequenced so that *mixed human–agent collaboration* is **v1.1** (it was
v1.2) and long-running/dependable operation is v1.2. The phases below are
the slide-driven view; the section at the end maps the 22 v1.1 roadmap
features onto concrete milestones and is the plan we are executing.

## The eight pillars

| # | Slide | Pillar | Status (2026-09-28) |
|---|-------|--------|---------------------|
| 1 | ha-members | **Membership** — people and agents on one roster, same roles | Partial. Humans (`workspace_memberships`, owner/admin/member/viewer) and agents (`workspace_members`, master/member/observer) are separate tables with different role vocabularies. Members page lists humans only. No Restricted role. |
| 2 | ha-routing | **Routing** — @mention either kind, mixed threads, tool steps inline, same status dots | Partial. Agents in composer autocomplete, humans are not. Tool steps are regex-parsed from markdown. Status was online/offline only → **now also "waiting" (amber) when an agent has a pending approval.** |
| 3 | ha-approvals | **Approvals** — gates in the conversation, policy decides who must sign off | **Phase 1 shipped on this branch** (see below). |
| 4 | ha-tasks | **Tasks** — one board, cards for people and agents, Needs-approval column | Partial. Kanban exists with agent assignees + classifier-driven `need_input`. **Approval requests now park/unpark the card deterministically.** No human assignees yet. |
| 5 | ha-context | **Shared context** — files, knowledge, shared browser | Mostly there. No "decisions" knowledge type. |
| 6 | ha-anywhere | **Escalation / inbox** — agents page people, people redirect agents, mobile | Partial. Inbox + FCM push exist and **approval requests file a high-priority `approval` notification**. Inbox is workspace-wide, not per-person; no web push. |
| 7 | ha-audit | **Audit** — every action attributable, replayable, exportable | Missing. `events` is a de-facto log; no admin activity page, no CSV, no actor/approval linkage. Approvals now record who/role/when for their slice. |
| 8 | ha-byoa | **Bring your own agent** — any vendor, one membership | Strong catalog (22 harnesses). Grants are coarse skill toggles; no per-tool policy. |

## Phase 1 — Approvals (this branch)

Why first: it is the primitive the deck leans on hardest (it appears on the
approvals, tasks, inbox, escalation and audit slides), and nothing existed —
every harness was launched with permissions bypassed and `AskUserQuestion`
disabled. "Approval" meant "an LLM guessed the agent looked blocked".

### What shipped

**Backend** (`workspace/backend`)
- `approvals` + `approval_policies` tables (migration `053_approvals`; was `052` until the 2026-09-30 merge with develop, see M0 below).
- `app/services/approvals.py` — policy resolution (built-in defaults ← workspace
  row ← channel row), request creation, resolution, Kanban parking.
- `app/routers/approvals.py`:
  - `POST /v1/approvals` (agent asks; policy may auto-approve/auto-block)
  - `GET /v1/approvals[?status&channel]`, `GET /v1/approvals/{id}`
  - `POST /v1/approvals/{id}/approve|reject` (role-checked)
  - `GET|PUT /v1/approval-policy[?channel]` (admin+)
- The request is posted into the thread as a `workspace.message.posted` event
  with `message_type: "approval"`; `workspace_mod` never routes that type to
  agents. The decision is posted back as a normal human message
  `@agent ✅ Approved: …` with `target_agents=[agent]`, so it reaches the agent
  through the poll path every other human message uses.
- Default policy mirrors the slide: deploy → Admin, spend → Owner,
  external send → any member, repo read/write → allow, delete data → block,
  shell/other → any member.
- Who may resolve: a signed-in member whose role meets `required_role`. A bare
  workspace token is accepted **only** on legacy workspaces with
  `require_login=False` (no identity exists there). On enforced-login
  workspaces the token never resolves — agents hold it and must not
  self-approve.
- 27 tests in `tests/test_approvals.py`.

**Agent side** (`packages/agent-connector`)
- MCP tools `workspace_request_approval` (blocks up to `wait_seconds`, default
  5 min, polling the record) and `workspace_check_approval`. Always on — not a
  skill toggle.
- Skills-mode (`SKILL.md`) gets an "Approvals" curl section; both modes get
  the guardrail: *before deploying, spending, emailing customers, deleting
  data or anything irreversible, request approval and wait; if PENDING, stop
  and end your turn.*

**Web** (`workspace/frontend`)
- `components/chat/approval-card.tsx` — inline card: action, kind, risk,
  details, who must approve, Approve / Reject (+ optional note), live verdict.
- Amber "waiting" presence dot on the agent roster (`lib/approvals.ts`
  `agentPresence`), fed by `pendingApprovalsByAgent` in the workspace context.
- Settings → **Approvals**: pending queue + workspace permission-policy table.
- `#?thread=<id>` deep links now work on the web (previously desktop only).
- `hooks/use-me.ts` (cached `/me`) so chat components can gate on role.
- EN + 中文 strings; `lib/approvals.test.ts`.

### Known limits / follow-ups for this pillar
- Harnesses still run with permissions bypassed; approvals are *cooperative*
  (the agent must call the tool). Phase 1b: relay the harness's own permission
  prompts (Claude `--permission-prompt-tool`, Codex approval callbacks) into
  the same gate so it is enforced, not advisory.
- Per-channel policy exists in the API; the thread header UI for it is not built.
- No expiry sweep for stale pending requests (`expires_at` is stored, unused).
- Inbox card is not actionable yet (tap → opens the thread; decide there).

## Phase 2 — Unified membership (next)
- One roster: `GET /v1/workspaces/{id}/members` returning humans + agents with
  a common `{kind, id, displayName, role, status, runtime}` shape; the Members
  settings page shows both, as on the slide.
- Map agent roles onto the workspace vocabulary (`master` stays a per-thread
  concept; workspace role = member by default) and add `restricted`.
- Enforce `viewer` on read-only routers.

## Phase 3 — Audit log
- `audit_log` table fed by approvals, role changes, invites, member removal,
  token rotation, agent add/remove, policy edits; `GET /v1/audit` with
  actor/channel filters; Settings → Activity page; CSV export.

## Phase 4 — Routing polish
- Humans in `@` autocomplete; structured tool-step events instead of
  markdown heuristics; "working" presence state from the composing signal.

## Phase 5 — Board + inbox
- Human assignees and an explicit **Needs approval** column driven by
  pending approvals; per-user inbox rows; actionable approval notifications
  (web + mobile).

## Phase 6 — Shared context + BYOA grants
- "Decisions" knowledge type (the deck's decision log for a channel).
- Per-agent tool/MCP allow-lists layered on the same policy table.

## v1.1 implementation plan (2026-09-30)

Roadmap v1.1 = "Mixed human–agent collaboration: private agents and threads,
with team sharing" (22 features: 5 carried-in prerequisites + 17 sharing
features). Release gate 1: *two people and one shared specialist* — an owner
shares reusable expertise, an invited colleague completes a request, resolves
an exception with the owner, retrieves the result, and repeats later while the
owner is away; scope, execution authority and cost ownership are explicit;
private context stays isolated; revocation sticks. Gate 2: collaborative
threads + the colleague's own agent working with the shared specialist.

### Where the codebase stands (survey 2026-09-30)

| Area | Today | Gap for v1.1 |
|---|---|---|
| Thread access | Every workspace member sees every channel: `/v1/discover` lists all channels, `/v1/events` has no per-human filter, `search=` is workspace-wide. `ChannelHumanMember` exists but is only used for push fan-out. No visibility flag on `Channel`. | Private threads, participant ACL, enforcement in discover/events/search/notifications/push/files/tasks. |
| Agent ownership | `WorkspaceMember` has `node_id`, `status`, `last_heartbeat`, `description`, `model` — no owner, no visibility, no personal-vs-team. | `owner` + `visibility` + grants to teammates. |
| Sharing | `ShareSnapshot` = read-only public snapshot of a whole channel. `WorkspaceInvite` carries email + role only, no target. No "invite into thread" endpoint. | Invite-to-thread, invite-to-agent, agent grants, sharing preview. |
| Escalation | Phase 1 approvals shipped (cooperative). Decision routes back to the agent as a targeted message. Inbox rows are workspace-wide (`NotificationRecord` has no recipient), cards not actionable. | Route to *owner*, per-user inbox rows, actionable card, help-request (non-approval) escalation. |
| Runtime availability | `WorkspaceMember.node_id` ↔ `Node.status/last_heartbeat`; develop now exposes `node_id` on discover. | Derived "runtime offline" state distinct from agent offline, shown on roster/composer/directory. |
| Busy / queued | Connector serialises one run per (agent, channel) and emits a "message queued" status; backend has no notion. | Surface busy + queue depth in presence and the directory. |
| Agent→agent handoff | Explicit `@` targets, `ChannelMember` auto-add, pull-based wake; B gets only the triggering message + history tool. | Structured handoff (request, context, output, next owner) and a tested two-agent scenario. |
| Artifacts | HTML renders in an iframe in the Files pane; not inline in the bubble. Task attachments exist (049). | Inline preview + "request revision" from the thread. |
| Cost ownership | `ModelAccess.created_by`; devices (formerly nodes) belong to whoever paired them. | "Whose credits / runtime" label on shared requests and in the directory. |

### Milestones

**M0 — Bring the prototype current (done 2026-09-30, this branch).**
Merged develop; renumbered `052_approvals` → `053_approvals` because develop
merged `052_add_agent_watches` (PR #734) with the same revision id. Preview
DB is stamped `052` = approvals and must be re-stamped `053` on redeploy.

**M1 — Ownership and visibility foundation** (features 6, 21; base for 20).
Schema: `workspace_members.owner_email`, `workspace_members.visibility`
(`personal|team`); `channels.visibility` (`private|shared|workspace`),
`ChannelHumanMember` becomes the ACL for non-workspace threads plus a
`channel_grants`-style row for agents. Enforce in `/v1/discover`,
`/v1/events` (incl. `search=`), notifications, push, files, tasks, shares.
Backward compatibility: all existing threads and agents are `workspace`/`team`.
Folds in Phase 2 (unified roster with a common `{kind,id,role,status,runtime}`
shape) because the Members page is where ownership becomes visible.

**M2 — Sharing actions and invitations** (features 7, 11, 19, 20).
Share an agent to selected teammates (grant rows), invite into a thread
(adds `ChannelHumanMember`), invites carry a target (`channel|agent|task`)
and the accept page lands there. Sharing preview lists exactly what becomes
accessible. Pins + "start another request with this specialist".

**M3 — Escalation to owner, runtime and busy signals** (features 1–4).
Help requests (not just approvals) go to the agent's owner; inbox rows get a
recipient and the card is actionable; connector's queued/busy status becomes
a presence state; "runtime offline" is derived from the node and shown where
the agent is picked. Resume-after-response is already the poll path; make the
states (working/waiting/failed/done) explicit on the roster and card.

**M4 — Specialist capability and directory** (features 8, 9, 10, 22).
Agent profile: purpose, example requests, required inputs, owner, availability,
whose credits/runtime. Owner reviews the shared instruction set and allowed
knowledge, previews the teammate's scope, runs a test request. Corrections
from later requests become proposals the owner approves (reuse the approvals
table with `kind=proposal`). Per-request isolation relies on the connector's
per-channel sessions; add the backend guard that a shared request never
resumes from a private channel (`resume_from`).

**M5 — Brief and the request experience** (features 12, 13, 14, 16, 17).
Per-thread work brief (objective, owner, latest result, open questions, next
step) editable by people; information-vs-execute distinction in shared
threads (extends develop's deterministic human `@` routing); inline HTML
artifact preview with "request revision"; results linked to the task.

**M6 — Gate 2 and follow-through** (features 5, 15, 18).
Structured two-agent handoff and a tested scenario (deploy specialist +
colleague's experiment agent); BYO agent identity/ownership in shared
threads; Slack browser preview last.

Audit log (Phase 3) stays out of v1.1 except for what approvals already
record. Phase 1b (harness permission-prompt relay) is v1.2 hardening unless
the pilots show cooperative approvals are not enough.

### Decisions needed before M1 lands
- Default visibility for **new** threads: `workspace` (today's behaviour,
  opt-in private) vs `private` (owner + invited only). M1 is built with
  `workspace` as the default and a per-thread toggle; flipping the default is
  a one-line change.
- Default for newly connected agents: `team` (visible to the workspace, as
  today) vs `personal` (owner only, shared on purpose).
