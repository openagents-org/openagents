# Humans + Agents: the Collaboration OS

Implementation roadmap for the OpenAgents Workspace vision in the
"Humans + Agents" deck (`bai/slides/openagents-talk-0429/humans-agents.html`,
slides `ha-*`). The deck's promise, in one line: *people and agents are
members of the same workspace, work is routed with @, agents act in the open,
humans approve at the gates that matter, and every action is attributable.*

This document maps each slide to what the product already does, what is
missing, and the order we are building it in. Branch: `feat/humans-agents-collab-os`. This doc: `workspace/docs/humans-agents-collab-os.md`.

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
- `approvals` + `approval_policies` tables (migration `052_approvals`).
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
