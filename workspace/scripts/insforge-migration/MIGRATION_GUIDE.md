# OpenAgents Workspace → InsForge + S3 + ECS Migration Guide

Step-by-step playbook for moving an OpenAgents Workspace from its hosted backend
(`workspace-endpoint.openagents.org`) to your own stack:

- **Database**: InsForge Postgres (PostgREST exposed)
- **File blobs**: AWS S3 bucket
- **Backend**: AWS ECS Fargate behind ALB + ACM cert
- **Frontend**: InsForge Vercel deployment

This was executed end-to-end on 2026-04-25 for workspace `0048fff6` (Peakmojo Team).
The full transcript is in [CONVERSATION.md](./CONVERSATION.md).

---

## ⚠️ Read this before you start: existing agents and threads break

The new backend has a different hostname (`https://agents-api.<your-domain>`) than the old one (`https://workspace-endpoint.openagents.org`). Agent connectors, MCP clients, IDE integrations — anything currently posting into the workspace — are pinned to the **old** endpoint and won't follow the data over.

**Concretely, after the cutover:**

- Existing **agent processes keep talking to the old workspace**. They'll appear "online" on the old URL and "offline" on the new one. Their messages don't reach the migrated stack.
- Existing **message threads will look frozen** on the new backend until agents reconnect — the historical events are there, but no new replies arrive.
- The migration copies `password_hash`, so the **same workspace token validates against both backends**. That's a footgun: a misconfigured client may keep working against the old URL and you won't notice until you wonder why the new stack is quiet.

**Recovery (per agent):**

1. Update the agent's connector config to the new endpoint: `https://agents-api.<your-domain>`.
2. **Create a fresh agent identity** in the migrated workspace and reconnect using its token. Renaming an existing agent to match the migrated name *may* work (the row is in the new DB) but was not tested in this migration — assume you need a fresh identity unless you've verified otherwise.
3. Shut down the old connector process so it stops writing to the dead source workspace.

Plan agent re-onboarding into the cutover window. If you have N long-running agents, expect ~N × a-few-minutes of manual reconnection work.

---

## Phase order (high-level)

| # | Phase | Reversible? | Required input |
|---|---|---|---|
| 1 | Provision **target S3 bucket** | yes (`s3 rb`) | none |
| 2 | Provision **target InsForge schema** (Postgres) | yes (drop tables) | linked InsForge project |
| 3 | Run the **data pump** (events + files + metadata) | yes (delete rows + bucket purge) | source workspace token |
| 4 | Verify counts + sample reads | n/a | — |
| 5 | Wire **ECS task** to new DB + S3 | yes (`update-service` to prior revision) | InsForge Postgres password |
| 6 | Cut over the frontend (already deployed for new endpoint) | DNS-level | DNS control |

You can stop at any phase. Phases 1–4 don't touch your prod backend at all.

---

## Phase 1 — Provision the S3 bucket

Bucket name must be globally unique. Match the region of your ECS cluster (lower latency).

```bash
aws s3api create-bucket \
  --bucket openagents-files-<your-suffix> \
  --region us-east-1 --acl private

aws s3api put-public-access-block --bucket openagents-files-<your-suffix> \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-versioning --bucket openagents-files-<your-suffix> \
  --versioning-configuration Status=Enabled
```

Round-trip check (always do this — proves credentials and policy are right):

```bash
echo test | aws s3 cp - s3://openagents-files-<your-suffix>/_preflight/x.txt
aws s3 cp s3://openagents-files-<your-suffix>/_preflight/x.txt -
aws s3 rm s3://openagents-files-<your-suffix>/_preflight/x.txt
```

> ⚠️ **AWS S3 only**, not S3-compatible. The OpenAgents `S3FileStore` at
> `workspace/backend/app/storage.py:84-109` doesn't accept `endpoint_url`.
> R2 / B2 / MinIO would need a tiny code change.

> ⚠️ **Object key shape is fixed**: `{workspace_id}/{file_id}/{filename}`
> (storage.py:92). The pump must write to the same shape; the backend reads
> from there post-cutover.

---

## Phase 2 — Apply the schema in InsForge

InsForge cloud (at the tier we used) has **no managed migrations** —
`db migrations` errors with *"Database migrations are not available on this
backend."*  Apply schema via `db import` instead.

```bash
cd <repo root>
npx -y @insforge/cli link        # if not already linked
npx -y @insforge/cli current     # confirm project + region
npx -y @insforge/cli db import workspace/scripts/insforge-migration/0001_initial_schema.sql
npx -y @insforge/cli db tables   # expect 17 tables (16 OpenAgents + alembic_version)
```

The schema mirrors `workspace/backend/app/models.py` 1:1 (same names, types,
PKs, indexes) so the OpenAgents backend can be repointed at this DB without
code changes.

> ⚠️ **You MUST stamp `alembic_version` to head**, otherwise the backend's
> `entrypoint.sh` runs `alembic upgrade head` on every container start, which
> tries to re-CREATE existing tables and the container exits 1.
> `0001_initial_schema.sql` already includes a final `INSERT INTO
> alembic_version VALUES ('014')`. **Update '014' if the source repo's
> alembic head changes.**  Find current head with:
> `ls workspace/backend/alembic/versions/ | tail -1`.

---

## Phase 3 — Run the data pump

The pump (`migrate.py`) reads from the source workspace API via
`X-Workspace-Token` and writes to:

- **InsForge** via PostgREST (`POST /api/database/records/{table}`,
  batched 200 rows/req, idempotent via `Prefer: resolution=merge-duplicates`
  for state and `ignore-duplicates` for the immutable event log).
- **S3** via boto3 `put_object`.

```bash
cp workspace/scripts/insforge-migration/.env.example \
   workspace/scripts/insforge-migration/.env
# Edit: SOURCE_WORKSPACE, SOURCE_TOKEN, S3_BUCKET, S3_REGION
# (INSFORGE_OSS_HOST and INSFORGE_API_KEY auto-load from .insforge/project.json)

cd workspace/scripts/insforge-migration
python3 migrate.py
```

The script captures a **snapshot point** (newest event id + timestamp) at
the start and never crosses it — live writes after start are intentionally
dropped.

State persists in `.migration-state.json` (event cursor, files done, files
failed). The script is **resumable**: re-run after a crash and it picks up
where it left off.

### Dry-run on one channel first

```bash
DRY_RUN_CHANNEL=channel-c40a603c python3 migrate.py
```

This proves the file path round-trip (download from source → upload to S3)
works against a small subset before committing to the full run.

---

## Phase 4 — Verify

Migration script ends with a count-match assertion:

```
events: source-migrated=25782 target=25782
files:  source-migrated=190   target=190
OK — counts match
```

Spot-check a known file end-to-end:

```bash
aws s3 ls s3://openagents-files-<your-suffix>/<workspace-uuid>/
# Pull one and verify size matches files.size in DB
```

---

## Phase 5 — Wire ECS to new DB + S3

### 5a. Get the Postgres password

InsForge **does not expose** the Postgres password via CLI or API. You must
fetch it from the dashboard:

1. https://insforge.dev → sign in → project → **Settings → Database**
2. Copy the `DATABASE_URL` (or the password and assemble it):
   `postgresql://postgres:<PWD>@<appkey>.<region>.database.insforge.app:5432/insforge?sslmode=require`

### 5b. Create a task IAM role with S3 access

The default `ecsTaskExecutionRole` is for image pulls / log writes. The task
itself needs a separate role for S3.

```bash
aws iam create-role --role-name openagents-workspace-task-role \
  --assume-role-policy-document file://oa-task-trust.json

aws iam put-role-policy --role-name openagents-workspace-task-role \
  --policy-name S3FileStoreAccess \
  --policy-document file://oa-task-s3-policy.json
```

Trust policy (`oa-task-trust.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ecs-tasks.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
```

S3 policy (`oa-task-s3-policy.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow",
     "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"],
     "Resource": "arn:aws:s3:::openagents-files-<your-suffix>/*"},
    {"Effect": "Allow",
     "Action": ["s3:ListBucket"],
     "Resource": "arn:aws:s3:::openagents-files-<your-suffix>"}
  ]
}
```

### 5c. Register a new task-def revision

```bash
aws ecs describe-task-definition --task-definition <family>:<current> \
  --region us-east-1 --output json > td-current.json

# Edit td-current.json:
#   - drop read-only fields: taskDefinitionArn, revision, status,
#     requiresAttributes, compatibilities, registeredAt, registeredBy
#   - add: "taskRoleArn": "arn:aws:iam::<acct>:role/openagents-workspace-task-role"
#   - update env:
#       DATABASE_URL          → new InsForge postgres URL
#       FILE_STORAGE_BACKEND  → s3
#       S3_BUCKET             → openagents-files-<your-suffix>
#       S3_REGION             → us-east-1

aws ecs register-task-definition --cli-input-json file://td-new.json \
  --region us-east-1
```

### 5d. Update the service

```bash
aws ecs update-service --cluster openagents-workspace \
  --service workspace-backend \
  --task-definition openagents-workspace-backend:<new-revision> \
  --region us-east-1
```

ECS does a Fargate rolling deploy: new task spins, LB health-checks it, old
task drains. Watch with:

```bash
aws ecs describe-services --cluster openagents-workspace \
  --services workspace-backend --region us-east-1 \
  --query 'services[0].deployments[*].{r:rolloutState,run:runningCount,td:taskDefinition}'
```

Wait until you see one deployment, `rolloutState=COMPLETED`,
`runningCount=desiredCount`.

### 5e. Verify end-to-end

```bash
# Workspace lookup hits new DB
curl https://<your-api-host>/v1/workspaces/<workspace-uuid> \
  -H "X-Workspace-Token: <token>"

# File download exercises new S3 IAM role
curl -o /tmp/x.bin https://<your-api-host>/v1/files/<file-id>?network=<workspace-uuid> \
  -H "X-Workspace-Token: <token>"
md5sum /tmp/x.bin
```

---

## Ongoing operations — the ECS task env contract

After Phase 5, the routine of "build new image → push → register new task
def → roll service" is mechanical AWS CLI work. Claude Code (or any agent
with AWS credentials) can run that loop on its own.

What an agent **cannot** know without being told:

- which env vars exist on the task definition,
- what their values must be,
- which other systems own each value,
- and which env vars must never be invented or replaced from memory.

This section is that contract. It exists so the next deploy doesn't drop or
mutate an env var because someone reconstructed the task definition from
their head instead of from the live config.

### Two non-negotiable rules

1. **Never reconstruct the task definition from memory.** Always start from
   `aws ecs describe-task-definition` of the current revision, modify with
   `jq` (or equivalent — only mutate what you intend to change), and
   re-register. Drift between what was last applied and what's running is
   invisible until something breaks.
2. **Always diff `containerDefinitions[].environment` before
   `update-service`.** Compare the new revision's env array against the
   previous revision's. If the diff is non-empty for any var you didn't mean
   to change, your filter dropped or mutated something — fix it before
   pointing the service at the new revision.
3. **Pin the task definition's `image` to an immutable digest
   (`@sha256:…`)**, not `:latest`. The task def then carries the historical
   record of what shipped, rollback is one service update, and a re-pushed
   `:latest` can't silently mutate what's running.

### The eight env vars

All eight are inline on `containerDefinitions[0].environment`
(`secrets: null` — none are in Secrets Manager / SSM today).

| Name | Source of truth | Format / valid values | What breaks if wrong |
|---|---|---|---|
| `DATABASE_URL` | InsForge dashboard → Settings → Database (password is **not** exposed via CLI/MCP — manual copy) | `postgresql://postgres:<PWD>@<appkey>.<region>.database.insforge.app:5432/insforge?sslmode=require` — `?sslmode=require` mandatory for managed Postgres | Container exits at boot on `psycopg2.OperationalError`; CloudWatch may stay silent (see AWS/ECS gotcha) |
| `S3_BUCKET` | Output of Phase 1 (`openagents-files-<your-suffix>`) | Globally-unique S3 bucket name in the same AWS account as ECS | File uploads/downloads return 5xx; storage adapter raises `NoSuchBucket` |
| `S3_REGION` | Region the Phase 1 bucket was created in | AWS region code, e.g. `us-east-1` | Cross-region calls add ~70ms per file op; usually still works |
| `FILE_STORAGE_BACKEND` | Architecture decision | `s3` (production) or `local` (dev only — writes to container FS, lost on every redeploy) | If unset, defaults to `local` → uploaded files vanish on the next deploy with no error |
| `WORKSPACE_ENDPOINT` | The public hostname clients hit (Route 53 → ALB) | `https://<your-api-host>` — no trailing slash | Absolute URLs the API embeds in events (file links, OAuth callbacks, …) point at the wrong host; the API itself still serves |
| `CORS_ORIGINS` | The complete list of frontend hostnames that talk to this API | Comma-separated origins, no spaces, no trailing slash, each `https://...` | Browsers see CORS errors that look like the API is down. **Add the InsForge URL** when you deploy a new frontend. |
| `AUTH_MODE` | Auth architecture | `workspace_token` for self-hosted single-tenant (this stack); other values change the auth flow entirely | Auth check fails for every request → 401 |
| `IDENTITY_MODE` | Identity provider mode | `standalone` for self-hosted (no external IdP); other values trigger OIDC/SSO flows that need extra config | Container boots but every login returns 401 / 500 |

### Things that must NOT be env vars

- **AWS credentials** (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Use
  the Fargate task role from Phase 5b — boto3 picks them up from the IMDS
  endpoint automatically. Inline AWS keys in task envs are a leak waiting
  to happen.
- **Long-lived API keys** for third-party services. Register them in AWS
  Secrets Manager and reference via `containerDefinitions[0].secrets[]` —
  not `environment[]`. Anyone with `ecs:DescribeTaskDefinition` (most
  read-only IAM roles) can read inline env values.
- The Postgres password is currently inline inside `DATABASE_URL` because
  InsForge's docs ship it that way; ideally it moves to Secrets Manager
  too.

### Cross-system bindings — change one, change the other

| You're changing | Other side that must move with it |
|---|---|
| Frontend hostname (deploying to InsForge / Vercel / a new domain) | Add it to `CORS_ORIGINS` on the task def — same release |
| `S3_BUCKET` | The IAM task-role policy from Phase 5b (allowed-resource ARN) |
| InsForge project | `DATABASE_URL` AND a fresh Phase 3 data pump run — different projects = different Postgres instances |
| Public API hostname | `WORKSPACE_ENDPOINT` AND every agent connector's URL (see warning at the top of this file) |

---

## Things to look out for (gotchas)

These all bit us. Fix them up-front and the migration is uneventful.

### Source data quality

- **Phantom channels**: `/v1/events/latest-per-channel` may list channel
  names that have no row in the `channels` table — typing typos or test
  events where someone posted to `channel/does-not-exist-xyz`. The detail
  endpoint returns 404 for these. **Tolerate 404s and log.**
  (`migrate.py` does this via `src_get(..., allow_404=True)`.)
- **Orphaned file blobs**: file metadata can exist while the underlying blob
  is missing — `GET /v1/files/{id}/info` returns 200 but `GET /v1/files/{id}`
  returns 500. We saw 16/206 files in this state on the source. **Tolerate
  per-file 5xx, log to `files_failed`, continue.** (Matches
  baryhuang/openagents#5.)

### Schema / app boot

- **Forgetting `alembic_version`** is the single most likely cause of a
  cold-start crash. Symptom: container exit code 1, no logs. (See "logs are
  silent" below — you won't even know what crashed without poking.)
- **Source `id` columns are TEXT, not UUID** for `events` and `files`. Don't
  retype them as `uuid` in your schema or inserts will fail.
- **`network_id` on `events` has no FK** to `workspaces.id` — matches source
  behavior. Don't add one or replay across workspaces breaks.
- **Channel `participants` is a JSON array of agent names**, but on insert
  these become rows in `channel_members`. Don't store the array twice.

### InsForge specifics

- **No managed migrations on the cloud free/hobby tier.** `db migrations`
  returns "not available on this backend". Use `db import <file>` and stamp
  `alembic_version` manually.
- **Postgres password is not exposed** via CLI, MCP, or any documented API
  path. The control-plane endpoint `/projects/v1/{id}` returns metadata but
  not credentials. Manual dashboard fetch is the only way (or a "rotate
  password" flow if the dashboard offers one). I confirmed 404 for: `/postgres`,
  `/db`, `/database`, `/credentials`, `/connection`, `/connection-string`,
  `/api-keys`, `/keys`, `/secrets`, `/anon-jwt`, `/service-jwt`.
- **Multiple InsForge projects per account** are common. `npx insforge list`
  to see them all. Confirm `npx insforge current` matches the project the
  ECS DATABASE_URL targets — easy to migrate into the wrong one and not
  notice until cutover serves an empty workspace.
- **PostgREST table API path is** `POST /api/database/records/{table}` (not
  `/api/database/{table}`). Body **must be an array**, even for single rows.
  Use `Prefer: resolution=merge-duplicates` for upserts (state tables) and
  `resolution=ignore-duplicates` for immutable logs (events). Batch ~200
  rows per call.
- **InsForge Storage adapter doesn't exist in OpenAgents.** If you want
  blobs in InsForge Storage instead of S3 you'd need to add an
  `InsForgeFileStore` class to `workspace/backend/app/storage.py` mirroring
  `S3FileStore` (~80 LOC).

### AWS / ECS

- **Default task has no `taskRoleArn`** — only `executionRoleArn`. Adding
  S3 env vars without a task role gets you `AccessDenied` on every file
  read. Always create the task role + policy in the same change set.
- **Fargate task IPv4 is in the cluster's VPC**. Make sure the subnet has
  outbound internet access (NAT or public IP) so the container can reach
  `*.database.insforge.app:5432` and `s3.amazonaws.com`.
- **CloudWatch log streams existed but were 0 bytes** for every prior task
  in our environment. The awslogs driver was wired correctly in the task
  def, but nothing was being written. We never figured out why. **If your
  container crashes, don't assume CloudWatch will show it — have a backup
  diagnostic ready** (e.g. `docker run` the same image+env locally, or use
  `aws ecs execute-command` if `enableExecuteCommand=true`).
- **Cross-region surprise**: the prior ECS env had DB in `us-west` while ECS
  itself ran in `us-east-1`. Cross-region adds ~70ms per query. Match
  regions when you cut over.
- **Cross-compile for `linux/amd64` on Apple Silicon dev machines**.
  Default `docker buildx` on M-series Macs targets `linux/arm64`. Fargate
  defaults to `LINUX/X86_64`; without `--platform linux/amd64` the
  container exits immediately with `exec format error`. Combined with the
  silent CloudWatch issue above, the failure looks like the task just
  "didn't start".
- **`:latest` in a task definition is a footgun**. The task-def loses any
  record of which build is running, rollbacks become guesswork, and a
  re-push of `:latest` can mutate prod without a service update. Pin the
  task-def's `image` to the immutable digest (`@sha256:…`) and use the SHA
  tag (`:9f5b3f7c`) only for human-readable lookups in the registry.
- **`--force-new-deployment` is a restart, not a release**. It re-pulls
  whatever the current task-def points at — useful when `:latest` was
  silently re-pushed (don't), or to recover a wedged task. Make a new
  task-def revision when you actually want to ship something new.
- **`docker buildx` can mangle a second `-t` flag** under some BuildKit
  versions (`repo:latest` becoming `repoatest:latest`, then failing with
  "repository does not exist"). Pass one tag at build time and use
  `docker buildx imagetools create` to add `:latest` afterwards — it's a
  manifest copy, no layer re-upload.

### Rollout safety

- **Rollback is one command**:
  `aws ecs update-service ... --task-definition <family>:<previous-revision>`.
  Practice it once before you actually need it.
- **Don't decommission the source workspace until you've smoke-tested the
  new stack for at least a few hours of real traffic**. Read paths +
  write paths + file uploads + file downloads + agent reconnects.
- **DNS / CORS**: the new backend's `CORS_ORIGINS` env must list your
  frontend hostname (e.g. `https://agents.caremojo.app,https://<appkey>.insforge.site`).
  Otherwise the browser sees CORS errors that look like the API is down.

---

## Files in this directory

| File | Purpose |
|---|---|
| `0001_initial_schema.sql` | Schema for the new InsForge DB |
| `migrate.py` | Data pump (events + files + metadata) |
| `.env.example` | Environment template for the pump |
| `.env` | Local secrets (gitignored) |
| `.migration-state.json` | Resume state (cursor + files done/failed) |
| `MIGRATION_GUIDE.md` | This file |
| `CONVERSATION.md` | Full transcript of the executed migration (sanitized) |

---

## What still isn't done after Phase 5

- 16 files with broken source blobs are in `.migration-state.json` →
  `files_failed`. Re-run `migrate.py` if those blobs ever come back.
- The old InsForge project the ECS used to point at is now dormant — keep as
  backup or delete.
- The original source workspace (`workspace-endpoint.openagents.org`) is
  still live and accepting writes from any old connector that's still
  pointed at it. Repoint or shut down each agent — see the warning at the
  top of this file for the per-agent recovery steps.
- CloudWatch logging for the ECS task is silent (0 bytes per stream). Worth
  fixing separately.
