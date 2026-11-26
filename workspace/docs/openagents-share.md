# OpenAgents Jam

Share an agent from your own coding session with your team: one instruction in the session, one link for teammates, and they use the agent in a real Workspace thread without an account.

Status: step 1 (the real local loop) is built behind this branch. Decisions below marked **Decided** come from the product owner; **Proposed** are working defaults for step 1, open to change in the product review.

## Decisions

| Topic | Status | Decision |
|---|---|---|
| Base branch | Decided | Build on `develop`. Hosted-only parts (cloud spend, analytics) go to `openagents-release`. |
| Entry point | Decided (for now) | A copy-paste instruction that works in any agent: *"Read `<API>/v1/share/instructions` and follow it to share this agent with my team."* Registering as a plugin on agent platforms comes later. |
| Account | Decided | Sharing never requires an account. A signed-in publisher owns the workspace from the start (`Authorization` on publish). An anonymous publisher gets an owner link; signing in from it keeps the workspace. |
| What is shared | Decided | The person chooses. The agent drafts title, role, intro and excerpts, shows them verbatim, and publishes only after an explicit yes. |
| Link expiry | Decided | The person chooses; default **never**. Owner can change it (null = never) or revoke at any time. |
| Role instructions | Proposed | Stay on the sharer's computer (the shared agent's `CLAUDE.md`/`AGENTS.md`). The thread only gets the intro and excerpts. |
| Context isolation | Proposed | The shared agent is a fresh agent with role + approved excerpts, never the original session, so a guest can't extract what wasn't shared. |
| Guest identity | Proposed | Reading needs nothing. Posting asks for a display name and mints a per-browser guest session (only its hash is stored). Guests post as `guest-<id>@guest.invalid`; no sign-in can ever claim that domain. Guests are not added to the workspace roster. |
| Guest scope | Proposed | One thread: read messages, post, ask that thread's agents. No other threads, files, members, settings, or approvals. Member emails are replaced by display names in what a guest receives. |
| When the agent runs | Proposed | The shared thread is passive: a plain message is a comment and runs nothing. Only a message addressed to the agent (`@name`, or the composer's "Ask" toggle) starts a run. |
| What a guest can make the agent do | Proposed | A guest's turn runs **read-only** on the sharer's computer: Read/Glob/Grep in the agent's own folder plus WebFetch/WebSearch; no shell, no file writes, no skipped permissions — whatever mode the owner set. Implemented for Claude Code; other agent types decline guest requests with a notice instead of running with the owner's rights. The launcher advertises `guest_turns` on join; the server never routes a guest's request to a client that didn't (older launchers), and tells the guest the owner needs to update. |
| Abuse limits | Proposed | Per guest 60 posts/hour, per link 300 posts/hour, 200 guests per link. Retried posts (same idempotency key) are delivered and counted once. |
| Spend: local agent | Proposed | No money cap (tokens are the sharer's own plan and we can't price them). Controls are count-based limits above, the on/off of the local launcher, expiry and revoke. A per-link daily run cap is the next lever if needed. |
| Spend: cloud (Acenta) | Open, hosted-only | Owner sets a dollar cap for the cloud workspace; reserve before dispatch, settle after; pause at the cap with the thread still readable. Never move local work to cloud silently. Not in step 1. |
| Offline sharer | Proposed | The thread stays readable and postable. The guest page says the agent is offline and answers when the sharer's computer is back. |
| Fork, bring-your-agent, claim UI | Built | See the sections below. |
| Cloud | Later | Step 5 of the handoff. |

## How it works (step 1)

1. The person pastes the instruction into their agent session. The agent reads `GET /v1/share/instructions` (served by this backend with its own URLs, so self-hosters hand out their own endpoints).
2. The agent explains what sharing does, drafts the share, and waits for a yes.
3. `POST /v1/share/publish` creates a workspace, one passive thread with the agent as its only member, the approved excerpts and intro as the first messages, and a guest link. Idempotent on `idempotency_key`.
4. The agent writes the role into `~/.openagents/shared/<agent>/CLAUDE.md` and connects itself with the OpenAgents launcher (`create --path`, `connect <token>`, `up`).
5. A teammate opens `/jam/<token>`, reads, picks a name, and asks `@agent …`. The message is routed to the sharer's local agent, which runs a read-only turn and replies in the thread. The sharer sees everything from the owner link.

## The owner's side

The owner link opens a **light jam page** (`/jam/own/<slug>?token=…`): just the conversation, its guest link controls and **Keep this conversation**. The full workspace UI appears only after keeping:

- **Make it my workspace** — sign in (or sign up); the Share workspace becomes theirs (`/v1/guest-links/claim`) and opens as a normal workspace with this conversation in it.
- **Add to one of my workspaces** — for people who already use OpenAgents: pick a workspace they're a member of (`/v1/guest-links/import`). The thread with its history, the agent and the guest link move there; the guest link keeps its URL and guests; the thread is private to them until they share it. The agent's launcher is told to follow (a `relocate` control action) and collects a fresh connection once; then the old Share workspace closes and its owner link says where the conversation went. Moving needs the agent running on a launcher that supports it.

## Owner approval

The owner can switch a guest link to **I approve each request** (`approval_mode: "owner"`). A guest's message that addresses the agent is posted and shown at once but held from the agent; the owner sees it in the jam and approves (it is re-posted for the agent, as the guest, read-only as always) or declines. A short notice tells the thread either way. Comments are never held. After the conversation is kept or moved, owners and admins decide from the full Workspace (a banner on the thread), and a waiting request also lands in the keeper's inbox.

## Guests continue in their own workspace

A signed-in guest can take a private copy of the conversation (the messages they can see, no agent, no link back) into a new or existing workspace of theirs and continue there with their own agents. The original is untouched.

## More agents in a jam

**The owner's agents.** From the jam the owner adds another of their agents (**Add agent**: a name without spaces and a type). The reply carries the three launcher commands; the agent connects with the jam's workspace token, runs on the owner's computer and is asked like the first one (`@name`). Guests' requests to it follow the same rules (read-only turns, the owner's approval setting). The owner can remove any agent except the one the jam was shared for.

**Guests' agents.** When the owner allows it (`allow_guest_agents`, on by default, switchable later), a guest can bring their own agent. It gets a **limited connection** (a `nodes` row with `scope_channel` + `scope_agent`), never the workspace token:

- accepted only to join / heartbeat / leave as that agent name, to read that thread (plus its own control events) and to post there as that agent; everything else refuses it because `verify_workspace_access` never counts a limited connection as workspace trust (`access.py`, `access_model.is_machine_caller`, the events poll fast path, `nodes._machine_token_ok`);
- what it reads has people's addresses replaced (guests' own guest addresses stay);
- it stops working the moment the guest is removed, the link is turned off, expires or turns read-only, the owner switches guest agents off, or the agent is removed (`room_agents.scoped_node`);
- what it posts never starts another agent, so a guest can't drive the owner's agent through it;
- anyone in the jam may ask it. Its own guest's turns run normally on the guest's computer; everyone else's (the owner, other guests, other agents) run as guest turns, which the guest's launcher enforces. The join reply says whose agent it is (`scoped.owner_address`), and others' requests are routed only to a launcher advertising `scoped_turns`;
- up to 3 per guest, 12 agents per jam; guests' agents stay behind when the jam moves into a workspace.

## Thread resources on the share pages

Guests and the owner jam see the same strip a Workspace thread shows above its messages: **Artifacts** (files shared in the thread, browser sessions shown there), **Agents** and **Routines** (read-only; their instructions stay private). Files open in a viewer (images, PDF, markdown, tables, HTML in a sandboxed frame, download otherwise); browser sessions as view-only screenshots; message attachments render inline. Everything is scoped to that one thread. When sharing from Claude Code, the agent can include files the session produced; they are uploaded into the thread after publishing.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/v1/share/instructions` | anyone |
| POST | `/v1/share/publish` | anyone; optional bearer = owned by that account |
| GET | `/v1/guest-links?network=&channel=` | workspace owner/admin or workspace token |
| PATCH | `/v1/guest-links/{id}?network=` `{expires_at}` | same |
| DELETE | `/v1/guest-links/{id}?network=` | same |
| POST | `/v1/guest-links` `{network, channel, expires_at}` | same; only threads made by Share, one live link at a time |
| GET | `/v1/guest-links/workspace?network=` | anyone who can open the workspace: `{share: {claimed}}` or `{share: null}` |
| POST | `/v1/guest-links/claim` `{network}` | owner link token **and** a signed-in account |
| GET | `/v1/guest-links/jam?network=` | owner link token: the light jam (thread, agents, link, kept/moved) |
| GET / POST | `/v1/guest-links/jam/messages?network=` | owner link token: read / post as the owner |
| POST | `/v1/guest-links/import` `{network, target}` | owner link token **and** a signed-in member of `target` |
| POST | `/v1/guest-links/relocation/accept` | the moving agent's launcher (old token + its session id), once |
| GET | `/v1/guest-links/jam/requests?network=` | owner link token: guests' requests waiting for approval |
| GET / POST | `/v1/guest-links/requests[/{id}]?network=&channel=` | workspace owner/admin: the same after keeping or moving |
| POST | `/v1/guest-links/public/{token}/fork` `{target?}` | signed-in guest: a private copy in their workspace |
| GET | `/v1/guest-links/{public/{token}\|jam}/resources` | the thread's files, browser sessions and routines |
| GET | `/v1/guest-links/{public/{token}\|jam}/files/{id}` | a file the thread shows (artifact or attachment) |
| GET | `/v1/guest-links/{public/{token}\|jam}/browsers/{id}/screenshot` | a browser session the thread shows |
| POST | `/v1/guest-links/jam/requests/{id}?network=` `{decision}` | owner link token: approve / decline, once |
| POST / DELETE | `/v1/guest-links/jam/agents[/{name}]?network=` `{name, type}` | owner: add / remove one of their agents |
| POST / DELETE | `/v1/guest-links/public/{token}/agents[/{name}]` `{name, type}` | guest session: bring / remove their own agent (limited connection token in the reply, shown once) |
| GET | `/v1/guest-links/public/{token}` | anyone with the link |
| POST | `/v1/guest-links/public/{token}/guests` `{name}` | anyone with the link |
| GET | `/v1/guest-links/public/{token}/messages?after= \| ?before= &limit=` | anyone with the link |
| POST | `/v1/guest-links/public/{token}/messages` `{content, idempotency_key}` | guest session (`X-Guest-Session`) |

Tables: `thread_guest_links`, `thread_guests` (migration 102, new tables only).

## Try it on two devices

Person A (sharer) needs Node.js and Claude Code. Person B (guest) needs only a browser, ideally on another device.

1. **A:** in a Claude Code session that just did a useful review, paste: *Read `https://workspace-endpoint.openagents.org/v1/share/instructions` and follow it to share this agent with my team.* (Self-hosted: use your own API URL.)
2. **A:** check the preview the agent shows, edit if needed, say yes. Keep the owner link; send the guest link to B.
3. **B:** open the guest link. Read the shared excerpts. Post a plain comment with "Ask" turned off: nothing runs.
4. **B:** turn "Ask" on and paste a public GitHub PR link. Pick a name when asked. The status line says the agent runs on A's computer; the reply arrives in the thread.
5. **A:** open the owner link: B's messages show with a Guest badge. Sign in from the banner to keep the workspace.
6. **A:** in the thread's share panel, copy the link again, set it to expire in 1 day, then turn it off. **B:** refresh — the page says the link was turned off.
7. **A:** stop the launcher (`npx @openagents-org/agent-launcher stop <agent>`). **B:** with a new link, the status line says the agent is offline; posting still works.

## Known gaps / next

- Guests can't attach files.
- No live push to the guest page; it polls every few seconds.
- Anonymous publish has no rate limit, same as anonymous workspace creation today.
- WebFetch on guest turns can reach any URL the sharer's machine can, including local addresses. A URL policy for guest turns is a follow-up.
- Guest turns rely on Claude Code's WebFetch to read PRs. On a machine where WebFetch isn't available the reviewer says it can't fetch the diff.
- Only Claude Code runs guest turns; other agent types reply that they can't take guest requests yet.
- Keeping a workspace needs a sign-in round trip from the owner link; there is no "sign up first, then share" path inside the agent session yet.
- Production needs the user's OK for migration 102 (three new tables, nullable columns on `workspace_members` and `nodes`) before promotion.
