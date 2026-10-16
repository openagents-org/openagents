# Coordinated thread collaboration rollout

Prepared October 15, 2026. Production has **not** been changed. Preview and production share PostgreSQL and file storage; deployment must keep their permission handlers compatible.

## Included changes

- New approval kind `thread_agent_access_request` grants a particular person access to a particular agent in one thread. It never creates an `agent` grant, enables a DM, or grants access in another thread. Approval checks the current agent owner, both human participants and agent membership again. Existing direct-sharing approvals retain their original meaning.
- Grant checks revalidate membership and ownership on use. The owner can revoke a thread grant with `DELETE /v1/channels/{channel}/agents/{agent}/access/{email}?network={workspace}`. This endpoint remains available when new requests are disabled. There is not yet a dedicated grant-management panel for these records.
- Per-thread instructions and the explicit “review after” selection use existing event records. The settings endpoint requires the thread manager or agent owner to be a participant. Raw event publication cannot forge settings. The backend injects current instructions after routing, including manual routing selections and approved requests.
- Completion-driven routing supersedes the narrow reviewer-only handoff in dynamic conversations when enabled. The router considers the original request, recent completed results, previous assignments and per-thread responsibilities; it chooses one next agent and a specific task, asks the user, waits for input, or stops. An agent finishing a turn does not imply the user’s whole request is finished. The legacy review flag remains off.
- Proactive routing keeps the existing choice card for ambiguous requests. Missing role descriptions do not instruct the model to silently stop on a question or greeting addressed to the agents. Explicit human conversations, incidental attachments and test messages can still remain ordinary chat.
- Legacy Yumi rows with provider `openagents` use the server-managed assistant runtime even if their stored category is `chat`. This avoids obsolete row credentials without modifying existing data. A minimal request using preview's server-managed configuration returned HTTP 200; the affected workspace has a legacy chat row.

## Browser preview follow-up (October 16)

The compact frontend preview is deployed, but DM browser association needs the backend patch in this branch. The previous handler looked up every conversation as a `Channel`, silently skipping connector DM addresses (`dm:<counterpart>`). It now accepts that address or the UI's full pair, verifies a prior direct exchange in the same workspace, saves the canonical pair, and posts the browser artifact directly to the counterpart. It never infers a thread from an agent's presence. Existing channel behavior is preserved.

This patch is staged, not deployed. Include it in the compatible backend release; no migration or backfill is needed. The reported XE tab is already closed and has no association, so the patch does not restore that old live session. Validate a new explicit DM browser request after deployment. Closed sessions retain their new artifact message; live thumbnails only show while the associated tab is awake.

Thread-only access remains staged at the user's latest request. Deploying the browser association fix does not require enabling any thread-access or collaboration flags.

## Completion-driven orchestration (October 16)

Implemented on `codex/preview`, **not enabled on preview or production**. `COMPLETION_ROUTING_ENABLED` defaults to false; `COMPLETION_ROUTING_MAX_HANDOFFS` defaults to 6 (bounded 1–20). This feature is independent of thread-only access, which remains staged.

- Entry point: final chat answers carrying `status_kind=completed` and `in_reply_to` for an actual assignment to that sender. The connector now binds these replies to the active queued message separately for each channel; cloud agents already supply the parent ID. Progress/status/tool output, failed/partial runs, uncorrelated background results and old connectors without a parent ID do not start another agent.
- Persisted state on the originating human event tracks consumed assignments and the next expected result. A channel row lock serializes completion processing. Retries with different event IDs cannot dispatch twice. Initial parallel assignments wait until all assignees have completed. A newer human message supersedes the prior chain; Stop and access are checked again after the model call.
- The request and latest result retain both beginning and ending when long. The recent-history window filters out progress noise before limiting results. User-authored thread instructions and prior handoffs inform the next decision. Missing roles do not prevent a contextual handoff. No reviewer role or fixed sequence is mandatory.
- Only existing thread participants with already-approved execution access can be chosen automatically. Agents requiring fresh approval wait for user action. No access grants are created, and requester-specific shared context is preserved by local connectors.
- A handoff carries the next task in server-authored instruction metadata. Cloud replies dispatch cloud successors too; the persisted handoff budget replaces the smaller legacy cloud depth limit only for bounded server-authored continuations. Passive threads, direct messages, service/job streams and explicit workflow runs retain their separate behavior.
- Uncertain/invalid/model-unavailable decisions and the handoff limit produce the existing requester-only selection card on the agent result. Selecting an agent includes the original request, next task and latest result and checks access again. Stopped or superseded choices cannot restart work. Wait means paused for human/external input, not a scheduled retry.

Validation: 200 focused backend tests passed; connector checks cover queued correlation, parallel channels, shared context, failed Claude/Codex output and Stop. Frontend TypeScript validation and all 6 routing-card tests passed.

No schema change, migration, backfill, model call against customer conversations, Docker build, connector restart or production change was performed. Routing tests use mocked model decisions, so a controlled model-quality check remains part of release validation. Do not replay the customer’s linked conversation to exercise it.

## Data compatibility

No schema change, migration, backfill or bulk repair is required. New operations write ordinary settings events, approval records and resource grants in existing tables. Do not run migrations or restore backend source mounts. Keep preview background jobs disabled and its existing connection-pool limits unchanged.

## Release sequence

1. Review the backend/connector commit on `codex/preview` against release `8eeea530d70c39ca67b25c12b111518330542fc4`. Build and approve a production-compatible image through the normal release process. No image has been built in this task.
2. Deploy the new approval resolver and grant reader to **every production and preview backend replica first**, with all feature flags false. Keep the existing database configuration. Yumi's runtime fix applies immediately; it does not require credentials to be copied into rows.
3. Publish/update participating agent connectors with thread instructions and correlated completion replies before enabling orchestration. Old connectors cannot safely continue automatically. No connector was restarted in this task.
4. Keep `THREAD_AGENT_ACCESS_ENABLED=false` as requested. Enabling completion routing does not require thread-only grants. A future access rollout must deploy its new approval resolver everywhere before allowing requests.
5. Enable `THREAD_COLLABORATION_ENABLED` and then `COMPLETION_ROUTING_ENABLED` only in the approved coordinated release. Leave `AUTOMATIC_REVIEW_HANDOFF_ENABLED=false`. In an intentional test workspace, verify implement → review → fix → verify, ambiguous selection, a greeting, parallel assignments, revoked access, Stop during routing and a late/duplicate result. Check local and cloud chat agents and the actual router model’s choices before broader enablement.
6. Validate `/ready`, normal authentication and file access without triggering agent jobs. Explicitly exercise only approved test requests. Observe errors and review dispatches before broader enablement.

## Rollback

Disable `COMPLETION_ROUTING_ENABLED` to stop new contextual handoffs; keep the legacy review flag off. Disable new thread requests and collaboration settings with their separate flags. Keep the new approval resolver, grant reader and revocation endpoint deployed while any new-kind approvals remain; disabling creation alone does not cancel pending approvals. Do not downgrade these handlers to the old image while new requests can be decided. Frontend rollback is independent, and no database rollback is needed. Existing grants can be explicitly revoked by the owner; disabling a feature flag does not silently rewrite permissions.

## Validation and remaining release checks

Targeted backend checks cover thread isolation, editing permissions, spoofed settings events, same-millisecond saves, grants, revocation, routing, review deduplication and legacy Yumi dispatch. Frontend checks cover agent grouping, replies, resources, DOCX sanitization/conversion, authenticated downloads and local keyboard composition. Connector instruction application has a unit regression test. TypeScript checks pass.

Two broader Yumi tests fail identically on the unmodified baseline: `TestYumiTools.test_pairing_redeem_nodes_and_commands` (device pairing now requires a signed-in member) and `TestManagerTools.test_add_agent_set_leader_read_post` (old leader-setting request is rejected). They are not caused by this patch; release QA should update those old fixtures separately. No interactive browser tests or Docker builds were run.

The separate BrowserFabric branch `codex/shared-browser-keyboard` contains the live-view textarea/IME/paste fix, Unicode-safe CDP text insertion and corrected active-session capacity wording. Its backend must deploy before or alongside the viewer. It is staged, not deployed. The OpenAgents frontend can deploy independently: it adds focus on takeover, local screenshot IME support, fullscreen, a simpler new-tab dialog and readable capacity errors.
