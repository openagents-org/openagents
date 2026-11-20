# Conversation-linked routines

The workspace Routines page groups recurring tasks by their source conversation. The same routines appear in that conversation's resource shelf. Both surfaces use the same details panel for instructions, schedule, pause/resume, manual run requests and recent activity.

## Creation and corrections

“Create routine” asks for a conversation and a natural-language request, then puts that request in the conversation composer. Nothing is sent until the person sends it. The agent uses the existing `workspace_create_routine` tool to agree on the task and schedule. “Change through conversation” similarly drafts a request mentioning the responsible agent and routine ID; it preserves any existing draft.

The connector records the source channel on creation. `workspace_list_routines` in that source channel returns the linked routines and their current instructions, so the agent can update one in place. At each scheduled run the agent receives the source conversation reference, instructions to read relevant recent messages, and guidance to retain agreed corrections using `workspace_update_routine`. This uses the agent's existing workspace history and messaging tools, subject to their access controls; it does not automatically copy the whole conversation into the scheduler.

## Background execution and activity

Execution still uses the existing per-agent `routines:<agent>` queue, preserving the scheduler's atomic claim, busy-run protection and failure backoff. Ordinary output stays in that queue. The run prompt asks the agent to send important results and requests for approval or help to the source conversation. This is agent behavior, not a new server-side classifier or approval system.

New fire events include `routine_id`, `routine_agent` and `source_channel`. Activity is attributed to that fire and the original responsible agent, stopping at the next fire in the queue. The UI distinguishes an agent response from a proven successful outcome. Reported errors and runs unanswered beyond the scheduler's 30-minute recovery window need attention. Semantic blockers reported as ordinary chat (for example a request to log in) remain readable in the run result; they are not automatically classified as failures.

“Run now” marks an active routine due for the next scheduler tick. It does not bypass an existing run or failure backoff. Paused routines must first be resumed. The UI explains these constraints in the request acknowledgement.

## API and rollout

- `POST /v1/routines`: accepts `source_channel`; existing valid `channel` hints are retained as a compatibility fallback. Execution `channel_name` stays separate.
- `PATCH /v1/routines/{id}`: accepts `source_channel` to explicitly link an older routine without moving its queue or changing its schedule.
- `GET /v1/routines?network=...&channel=...`: matches source or execution channel; each result includes `source_channel_name` and `latest_run`.
- `GET /v1/routines/{id}/runs?network=...&limit=20`: recent history (maximum 50 entries).
- `POST /v1/routines/{id}/run?network=...`: requests a run through the scheduler.

Migration `099` adds a nullable source-channel column and indexes. Existing rows remain unlinked; the UI lets a person assign the correct conversation. Historical untagged events are never guessed into a routine's history and remain available in background activity. Apply the backend migration before serving the new model. No production migration is performed as part of local UI development.

## Validation

Backend coverage includes source validation and scoping, legacy links, preserving schedules on corrections, shared-queue history isolation, reassignment, stalled runs, manual requests and scheduler fire attribution. Frontend checks cover resource-shelf scoping and existing thread behavior; connector checks cover source-channel transport. The integrated UI was also exercised in an isolated local SQLite workspace, including pause/resume, history expansion, exact source navigation and draft handoff. Sample agents in that workspace are offline; it does not demonstrate a live model executing an external task.
