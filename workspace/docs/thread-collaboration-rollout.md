# Coordinated thread collaboration rollout

Prepared October 15, 2026. Production has **not** been changed. Preview and production share PostgreSQL and file storage; deployment must keep their permission handlers compatible.

## Included changes

- New approval kind `thread_agent_access_request` grants a particular person access to a particular agent in one thread. It never creates an `agent` grant, enables a DM, or grants access in another thread. Approval checks the current agent owner, both human participants and agent membership again. Existing direct-sharing approvals retain their original meaning.
- Grant checks revalidate membership and ownership on use. The owner can revoke a thread grant with `DELETE /v1/channels/{channel}/agents/{agent}/access/{email}?network={workspace}`. This endpoint remains available when new requests are disabled. There is not yet a dedicated grant-management panel for these records.
- Per-thread instructions and the explicit “review after” selection use existing event records. The settings endpoint requires the thread manager or agent owner to be a participant. Raw event publication cannot forge settings. The backend injects current instructions after routing, including manual routing selections and approved requests.
- Review handoff dispatches once for the latest assigned human request, only to an authorized reviewer in that thread. Explicit thread settings take precedence over legacy reviewer descriptions. Passive and workflow threads, greetings, unrelated replies and review loops are excluded. Dispatch means review is requested, not completed; actual reviewer output is still required.
- Proactive routing keeps the existing choice card for ambiguous requests. Missing role descriptions do not instruct the model to silently stop on a question or greeting addressed to the agents. Explicit human conversations, incidental attachments and test messages can still remain ordinary chat.
- Legacy Yumi rows with provider `openagents` use the server-managed assistant runtime even if their stored category is `chat`. This avoids obsolete row credentials without modifying existing data. A minimal request using preview's server-managed configuration returned HTTP 200; the affected workspace has a legacy chat row.

## Browser preview follow-up (October 16)

The compact frontend preview is deployed, but DM browser association needs the backend patch in this branch. The previous handler looked up every conversation as a `Channel`, silently skipping connector DM addresses (`dm:<counterpart>`). It now accepts that address or the UI's full pair, verifies a prior direct exchange in the same workspace, saves the canonical pair, and posts the browser artifact directly to the counterpart. It never infers a thread from an agent's presence. Existing channel behavior is preserved.

This patch is staged, not deployed. Include it in the compatible backend release; no migration or backfill is needed. The reported XE tab is already closed and has no association, so the patch does not restore that old live session. Validate a new explicit DM browser request after deployment. Closed sessions retain their new artifact message; live thumbnails only show while the associated tab is awake.

Thread-only access remains staged at the user's latest request. Deploying the browser association fix does not require enabling any thread-access or collaboration flags.

## Data compatibility

No schema change, migration, backfill or bulk repair is required. New operations write ordinary settings events, approval records and resource grants in existing tables. Do not run migrations or restore backend source mounts. Keep preview background jobs disabled and its existing connection-pool limits unchanged.

## Release sequence

1. Review the backend/connector commit on `codex/preview` against release `8eeea530d70c39ca67b25c12b111518330542fc4`. Build and approve a production-compatible image through the normal release process. No image has been built in this task.
2. Deploy the new approval resolver and grant reader to **every production and preview backend replica first**, with all three feature flags false. Keep the existing database configuration. Yumi's runtime fix applies immediately; it does not require credentials to be copied into rows.
3. Publish/update participating agent connectors with the thread-instruction adapter change before enabling collaboration. Old connectors cannot apply the new instruction metadata. No connector was restarted in this task.
4. After all servers support the new approval kind, enable `THREAD_AGENT_ACCESS_ENABLED`. The preview UI uses the capability returned by participants; an older backend leaves the button disabled. Never enable creation while any reachable approval handler still has the old semantics.
5. Enable `THREAD_COLLABORATION_ENABLED`, then `AUTOMATIC_REVIEW_HANDOFF_ENABLED` after verifying one controlled test conversation. These flags default to false. Verify executor → reviewer once, passive mode, a revoked grant, owner change and another-thread denial. Use an intentional test workspace; do not replay customer messages.
6. Validate `/ready`, normal authentication and file access without triggering agent jobs. Explicitly exercise only approved test requests. Observe errors and review dispatches before broader enablement.

## Rollback

Disable new thread requests, collaboration settings and automatic review with their flags. Keep the new approval resolver, grant reader and revocation endpoint deployed while any new-kind approvals remain; disabling creation alone does not cancel pending approvals. Do not downgrade these handlers to the old image while new requests can be decided. Frontend rollback is independent, and no database rollback is needed. Existing grants can be explicitly revoked by the owner; disabling a feature flag does not silently rewrite permissions.

## Validation and remaining release checks

Targeted backend checks cover thread isolation, editing permissions, spoofed settings events, same-millisecond saves, grants, revocation, routing, review deduplication and legacy Yumi dispatch. Frontend checks cover agent grouping, replies, resources, DOCX sanitization/conversion, authenticated downloads and local keyboard composition. Connector instruction application has a unit regression test. TypeScript checks pass.

Two broader Yumi tests fail identically on the unmodified baseline: `TestYumiTools.test_pairing_redeem_nodes_and_commands` (device pairing now requires a signed-in member) and `TestManagerTools.test_add_agent_set_leader_read_post` (old leader-setting request is rejected). They are not caused by this patch; release QA should update those old fixtures separately. No interactive browser tests or Docker builds were run.

The separate BrowserFabric branch `codex/shared-browser-keyboard` contains the live-view textarea/IME/paste fix, Unicode-safe CDP text insertion and corrected active-session capacity wording. Its backend must deploy before or alongside the viewer. It is staged, not deployed. The OpenAgents frontend can deploy independently: it adds focus on takeover, local screenshot IME support, fullscreen, a simpler new-tab dialog and readable capacity errors.
