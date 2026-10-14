# Migrating OpenAgents Workspace to v1.1

Updated: October 14, 2026. Audience: deployment operators and workspace owners.

This note covers the implementation on `feat/workspace-v1-1-collab`, reviewed at commit `6fe36d611`, with Alembic head **`080`**. “v1.1” here means the Workspace collaboration release; it is not the npm connector version or the backend package version. Pin the reviewed application commit and migrate the database to its matching revision.

The recommended sequence is: rehearse on a restored PostgreSQL database, confirm device ownership and sharing changes, take a cutover backup, migrate once, deploy the matching backend and frontend, then validate access and agent routing.

## 1. Changes owners should expect

| Area | Migration impact |
| --- | --- |
| Agents and devices | Devices have explicit human owners. Agents become private by default; automatic legacy “Everyone” grants are revoked. Owners must explicitly share agents that teammates should use. |
| Threads | New ordinary threads are private by default. Existing `workspace` visibility becomes `public`; this upgrade does **not** make all old threads private. DMs are migrated to private access. |
| Shared agent use | Direct agent access, permission to use an owner's agents within a thread, and access to a service are separate. Adding someone to a thread does not grant unrestricted access to every agent. |
| Proactive responses | Existing threads gain `response_mode=proactive`. Clear work requests can route without an @mention. Ordinary conversation can remain silent; uncertain requests offer a compact “Ask an agent” action. Explicit addresses, access checks, thread direction and approval requirements still apply. |
| Files and knowledge | Existing unattached files and knowledge retain public access through the compatibility backfill; thread files inherit thread access. Review sensitive historical material explicitly. New default file paths use `people/<normalized, URL-encoded email>/`; existing files are not automatically moved. Folder placement does not itself make a file private. |
| Browser previews | New browser artifacts can attach to threads and show screenshots. Historical tabs start with no thread associations; do not infer associations from agent membership. |

The earlier [permission-model specification](permission-model-v1.md) describes an older intermediate state, including automatic agent sharing. For this release, migrations `067`–`072` and the current access implementation take precedence.

## 2. Before scheduling the upgrade

- Record the running application revision and `alembic current`. From **`workspace/backend`**, run `alembic heads`; this release has one head, `080`. A database newer than this checkout needs a matching newer checkout, not a downgrade.
- Back up PostgreSQL, file storage (local volume or object storage), deployment configuration and required secrets. Verify restoration on an isolated database. Database backups alone do not contain uploaded file bytes.
- Rehearse the entire upgrade on that restored database. Isolate outbound notifications, routine execution and agent connections so the rehearsal cannot start real work.
- Agree on an owner for every legacy device connection. Also review agents that have no device and no owner; migration `067` only assigns agent owners from linked devices.
- Inventory agent grants and confirm who should retain direct access after automatic grants are removed. Check the special `070` conversion below before proceeding.
- Keep the existing authentication project, session signing secret, storage configuration and database endpoint. Configure `NEXT_PUBLIC_API_URL` before building the frontend; it is a build-time value. Confirm `CORS_ORIGINS` includes the deployed UI origin.
- For proactive routing, configure `ROUTER_LLM_ENABLED=true` and a working provider, model and key using `ROUTER_LLM_PROVIDER`, `ROUTER_LLM_MODEL`, `ROUTER_LLM_API_KEY` and, when needed, `ROUTER_LLM_BASE_URL`. The Anthropic key is a fallback. Validate the configured model on representative conversations; the feature flag alone does not prove routing works.

Use the deployment's normal secret injection. Do not paste credentials into this document or commit them with an owner mapping.

## 3. Migration changes that require attention

### Device ownership: revision `067`

The migration derives a device owner from its latest redeemed pairing code with a nonempty `created_by`. Any connection left without an owner blocks the migration. This check covers all rows in `nodes`, not just currently online devices.

For unresolved connections, supply a JSON map from **connection UUID** to the confirmed owner's email. The mapped owner must be a current workspace member with role `owner`, `admin` or `member`. Do not infer ownership from whoever administers the workspace.

For a pre-`067` database that already has the device tables, this read-only query helps review the inferred owners:

```sql
SELECT n.id AS connection_id, n.workspace_id, n.node_key,
       paired.email AS inferred_owner_email
FROM nodes AS n
LEFT JOIN LATERAL (
    SELECT lower(trim(p.created_by)) AS email
    FROM node_pairing_codes AS p
    WHERE p.node_id = n.id
      AND p.redeemed_at IS NOT NULL
      AND nullif(trim(p.created_by), '') IS NOT NULL
    ORDER BY p.redeemed_at DESC
    LIMIT 1
) AS paired ON TRUE
ORDER BY n.workspace_id, n.id;
```

Review inferred owners as well as missing ones. The explicit mapping can override an incorrect inference. Save the confirmed mapping securely for rehearsal and cutover. If the database already passed `067`, this migration argument will not reassign devices; use the supported ownership workflow instead.

### Sharing changes: revisions `067`, `068` and `072`

`067` and `068` revoke system-generated default agent grants. Explicit owner-created shares normally survive. Thread sharing gains `no`, `yes` and approval-based behavior; `072` maps existing enabled thread shares to `yes` and leaves the others at `no`.

After deployment, owners should review “Who can use this agent” and thread-specific agent sharing. Confirm access using an ordinary teammate account, not only an administrator or a machine token.

### Preview-specific conversion: revision `070`

**This migration contains a data conversion restricted to workspace slug `cef1c57a`.** It creates services for eligible agents, converts their active direct-agent resource grants to service grants, disables the owners' thread agent sharing and clears the old agent-level request approver.

Other workspace slugs receive the new schema without that conversion. If a production database contains `cef1c57a`, the conversion will run there too. Confirm that this is intended before running it. If it is not, prepare and review a deployment-specific migration plan before cutover; do not skip the revision by stamping the database.

### Irreversible cleanup: revisions `061` and `062`

These remove retired instruction-proposal and owner-question approvals and their associated events/notifications. Ordinary conversation is not broadly deleted, but the removed feature records cannot be reconstructed by their downgrade functions. Preserve the pre-upgrade backup if these records matter.

## 4. Cutover procedure

Schedule a maintenance window. Stop new writes and pause automated writers through the deployment's operational controls. Record pending work; do not replay requests automatically after the upgrade.

Run the following in the reviewed release's **`workspace/backend`** directory, using its installed Python dependencies and the target database environment:

```bash
alembic current
alembic heads
```

After taking and verifying the cutover backup, run exactly one migration job. Choose the appropriate command:

```bash
# No unresolved or incorrect device ownership, or already past revision 067:
alembic upgrade 080
```

```bash
# When crossing 067 with confirmed legacy ownership assignments:
# Replace both example values with the reviewed connection UUID and owner.
alembic -x 'device_owners={"CONNECTION_UUID":"owner@example.com"}' upgrade 080
```

If migration fails, keep maintenance in place, inspect the error and check `alembic current` before retrying. Fix the cause; do not use `alembic stamp` to hide a missing migration. Some migrations inspect and backfill live data, so generated offline SQL is not a substitute for rehearsal against PostgreSQL.

After successful migration:

1. Confirm `alembic current` reports `080` and matches `alembic heads`.
2. Start the matching backend and check `/health`, then authenticated workspace discovery and message retrieval. Health alone does not verify permissions or routing.
3. Deploy the frontend built from the same reviewed release with the correct API URL. Reload existing browser clients to remove stale UI code.
4. Validate a pilot workspace with its owner and a teammate before reopening normal traffic and automation.
5. Check connected agents. Use a tested connector compatible with this branch, including per-agent `X-Agent-Name` identity on API/tool calls. Record installed connector versions and roll out any necessary updates separately; do not assume every connected device has already updated.

**Deployment-specific notes:** Railway's checked-in `preDeployCommand` runs `alembic upgrade head`. If an owner mapping is needed, run the reviewed one-off migration first, or supply the mapping in that migration job before the automatic predeploy step. The backend container entrypoint does not run migrations. Self-hosted Compose therefore needs a separate migration job; restarting containers alone is insufficient. SQLite's startup `create_all` is not an upgrade strategy for an existing production PostgreSQL database.

## 5. Acceptance checks

Use a dedicated test conversation and intentional test requests for checks that start work.

- **Access:** the owner can see their devices and private resources. A teammate sees only public, participating or explicitly shared resources. Verify an unshared agent cannot be invoked and an approved shared agent can.
- **Data:** historical threads, DMs, uploaded files and knowledge remain accessible to the right people. Inspect missing owners and intended public/private visibility. Confirm preview-specific service grants only changed where intended.
- **Routing:** a clear task without an @mention reaches the appropriate executor; a review request reaches the reviewer; direct mentions work; human-to-human chat and casual uploads do not generate unwanted work. Test approval-gated and passive threads separately. Give executor and reviewer distinct descriptions.
- **Messages:** replies cite the original message; eligible recalls ask for confirmation; image uploads create one visible message without a redundant filename message.
- **Navigation:** avatars and thread icons update; unread messages produce thread/DM counts and the Threads badge clears as they are read.
- **Artifacts:** file previews open; browser actions record the correct thread association and show an actual screenshot. Screenshot requests require viewer authorization. Historical unassociated tabs are not automatically reassigned.
- **Notifications:** verify delivery and the in-app test sound after a user interaction, with the account's sound preference enabled. Check browser/site and OS audio settings separately from server delivery; mobile push also requires its configured credentials.

## 6. Recovery and rollback

Prefer a forward fix for a contained issue. Do not assume an application-only rollback or `alembic downgrade` restores the previous system: sharing semantics changed, service grants were converted in the named preview workspace, and retired records were deleted.

For a full rollback, stop writes and automated jobs, preserve a copy of the failed-upgrade state, restore the verified pre-upgrade database and matching file-storage snapshot, then deploy the matching previous backend/frontend/configuration. Validate access before reconnecting writers. Record and reconcile any post-cutover writes separately; restoring an earlier snapshot loses them unless recovered deliberately. Downgrading `067` also fails when two owners now have connections with the same workspace/device key.

## Scope of verification

The migration graph was checked locally and has one head at `080`. The current implementation passed 106 focused routing/backend tests, 14 frontend tests and frontend type checking during the preceding work. Read-only live routing probes covered the reported work request and casual uploads. These checks do **not** constitute a production PostgreSQL migration rehearsal. No production migration is performed by writing this note.

Source references: [migration files](../backend/alembic/versions/), [backend configuration](../backend/app/config.py), [Railway deployment](../backend/railway.toml), [container entrypoint](../backend/entrypoint.sh), [personal file paths](../backend/app/services/personal_files.py), [connector identity](../../packages/agent-connector/src/workspace-client.js).
