# Workspace ownership & permission model — v1.1 slice (spec + API contract)

Decided 2026-09-30 (channel decision log, page v2.1). This file is the build contract for the
v1.1 slice. Later slices (per-device tokens, backend intersection rule on every read, guests
UI, out-of-office delegate, audit log) are v1.2 and are NOT in scope here.

## 1. Model in one paragraph

Every resource has exactly one owner (a human, or an agent whose human owner can always
override). Access = owner ∪ grants (to a human, an agent, or a **security group**) ∪ public.
Humans and agents may belong to many groups; access is the union; there are no deny rules.
Agents inherit everything their human owner can access, plus their own groups. Threads are
**private by default** with two levels only: `private` (owner invites humans, agents, groups;
owner-controlled switch lets participants add people) and `public` (everyone in the workspace,
guests included, can see and self-join). Files and knowledge items have an owner and the same
private/public + grants model. Admins see **metadata only** for private things and can force an
ownership transfer; they never read. Devices (formerly nodes) are owned by the human who
connected them and only that human controls them. The personal/team flag on agents is gone:
what an agent can be used for is exactly its grants (new agents get an `everyone` grant by
default, owner can revoke).

## 2. Data model — migration `055_permission_model` (down_revision "054")

```
security_groups          id text pk, workspace_id uuid fk, name text, slug text, kind text
                         ('everyone'|'guest'|'custom'), created_by text, created_at
                         unique (workspace_id, slug). 'everyone' and 'guest' are created lazily
                         per workspace by get_or_create_builtin_groups(db, workspace_id).
security_group_members   group_id fk, principal_kind ('human'|'agent'), principal_id text
                         (lowercase email | agent_name), added_by, created_at
                         unique (group_id, principal_kind, principal_id)
resource_grants          id text pk, workspace_id, resource_kind ('channel'|'agent'|'file'|
                         'knowledge'|'browser_context'), resource_id text, grantee_kind
                         ('human'|'agent'|'group'), grantee_id text, rights jsonb (subset of
                         ["read","act","share"], default ["read","act"]), scope jsonb null,
                         expires_at null, budget numeric null, granted_by text, note text,
                         created_at, revoked_at null, revoked_by null
                         idx (workspace_id, resource_kind, resource_id); idx (workspace_id,
                         grantee_kind, grantee_id)
channels                 + owner_email text null (backfill: director_email, else NULL = owned
                         by the workspace), + participants_can_invite bool default false.
                         visibility values become 'private'|'public': UPDATE 'workspace'→'public'.
                         API accepts 'workspace' as an input alias for 'public' forever; outputs
                         'public'. DM channels (name starts with "dm:") → 'private' and both
                         parties get channel_human_members rows (backfill from the dm name).
file_records             + owner text ("human:<email>" | "openagents:<agent>"; backfill from the
                         existing source/uploader fields), + visibility text null
                         ('private'|'public'|NULL = inherit from channel_name). Backfill: files
                         with a channel → NULL (inherit); unattached → 'public' (compat).
knowledge_entries        + owner text (backfill from created_by/source), + visibility
                         ('private'|'public'); backfill existing → 'public' (compat).
workspace_members        visibility column stays but is DEPRECATED (ignored). Migration: every
                         agent with visibility 'team' (or NULL) gets resource_grants(agent →
                         group everyone, rights ["act"]); every row in agent_grants (not
                         revoked) is copied to resource_grants(agent → human). agent_grants
                         stays for one release; the old endpoints become shims (see §4).
```

Membership role gains the value `guest` (collaborators). The `guest` group's membership is
DERIVED: humans whose role is guest. `everyone` = all collaborators incl. guests (derived, no
member rows). Personal groups are implicit (a direct grant to a human).

## 3. Principals and the access rule (`app/services/access_model.py`, used by visibility.py)

```
Principal: kind ('human'|'agent'|'machine'), email, role, agent_name, owner_email, group_ids
  human   ← Firebase/session auth (as today)
  agent   ← workspace token + agent identity: header X-Agent-Name: <name> (preferred) or
            source=openagents:<name> in query/body. owner_email = that member's owner_email.
  machine ← workspace token without agent identity → legacy: full access (keeps scripts,
            persona, integrations working). v1.2 removes this.

allowed(P, R, right):
  owner(R) == P, or owner(R) is an agent whose owner_email == P.email        → allow
  R.visibility == public (threads/files/knowledge) and P is in the workspace  → allow read
  active grant on R for P (human|agent) or for a group containing P, right ∈ rights
                                                                              → allow
  P.kind == agent and allowed(owner-of-P as human, R, right)                  → allow (inherit)
  R is a file with visibility NULL → allowed(P, its channel, right)
  R is a message/task → allowed(P, its channel, right)
  P.kind == machine (no agent identity)                                        → allow (legacy)
  else                                                                         → deny
Thread participants (channel_human_members / ChannelMember for agents) count as grants
{read, act}. Admin: list private-thread METADATA + transfer only; no read.
explain(P, R) → {allowed, reason: 'owner'|'public'|'participant'|'grant'|'group:<name>'|
  'inherited_from_owner'|'inherited_from_channel'|'admin_metadata'|'machine'|'denied', text}
```

## 4. HTTP API contract (all under /v1, `network` query/body as elsewhere)

Groups (admin to mutate; any member to list):
```
GET    /groups?network=                      → {groups:[{id,name,slug,kind,member_count,builtin}]}
POST   /groups {network,name}                → group   (kind custom)
PATCH  /groups/{id} {network,name}
DELETE /groups/{id}?network=&dry_run=1       → {affected_grants:n, members:n}; without dry_run deletes
GET    /groups/{id}/members?network=         → {members:[{principal_kind,principal_id,display_name,added_by,created_at}]}
POST   /groups/{id}/members {network,principal_kind,principal_id}
DELETE /groups/{id}/members/{principal_kind}/{principal_id}?network=
```
Grants (owner of the resource, admin, or a holder of the `share` right; an agent may grant on
artifacts it owns):
```
GET    /grants?network=&resource_kind=&resource_id=      → {grants:[{id,resource_kind,resource_id,grantee_kind,grantee_id,grantee_label,rights,scope,expires_at,budget,granted_by,note,created_at}]}
POST   /grants {network,resource_kind,resource_id,grantee_kind,grantee_id,rights?,scope?,expires_at?,budget?,note?}
DELETE /grants/{id}?network=
GET    /grants/preview?network=&resource_kind=&resource_id=&grantee_kind=&grantee_id=
                                                          → {items:[{kind,id,title}]} what becomes accessible (channels: thread + files + tasks; agents: profile + example requests; files/knowledge: the item)
GET    /access/explain?network=&resource_kind=&resource_id=   → explain() for the caller
GET    /access/mine?network=                               → {groups:[...], grants:[...]} for the caller
```
Threads:
```
PATCH  /channels/{name} {network, visibility?: 'private'|'public', participants_can_invite?: bool, owner_email?: str}
       visibility/switch: owner or admin; owner_email: owner (hand over) or admin (forced transfer, audited as event network.channel.transfer)
GET    /admin/private-threads?network=            (admin) → [{name,title,owner_email,participant_count,message_count,last_activity_at}]
POST   /channels/{name}/join {network}            (public threads: self-join → channel_human_members row)
network.channel.create  defaults visibility 'private', owner_email = creator; payload may pass
                        visibility 'public' and human_participants/participants/groups
POST   /channels/{name}/participants              (existing) additionally allowed for participants when participants_can_invite
```
Files & knowledge:
```
GET /files, /files/browse, /files/{id}, /files/{id}/info   filtered/checked by allowed(P, file, read)
PATCH /files/{id} {network, visibility?}                     owner / admin
POST /files*, /knowledge                                     accept visibility? (default: humans and identified agents → 'private' (files in a channel → inherit); legacy machine callers → 'public')
GET /knowledge, /knowledge/{id}, /knowledge/by-slug/{slug}   filtered/checked
PUT /knowledge/{id}                                          + visibility; owner / admin / grant with act
responses of files and knowledge include owner, owner_label, visibility, effective_visibility, can_manage
```
Agents:
```
GET  /agents/directory            each entry + usable_by: {everyone: bool, groups:[{id,name}], people: n, agents: n}; drop 'visibility' semantics (field stays, value mirrors everyone grant for old clients)
POST /agents/{a}/grants, DELETE /agents/{a}/grants/{email}, GET /agents/{a}/grants   → shims over resource_grants (resource_kind agent, grantee human)
PATCH /workspaces/{id}/members/{agent}   body.visibility accepted but ignored (deprecated)
```
Devices (routers/nodes.py handlers re-exposed):
```
/v1/devices, /v1/devices/{device_id}, /v1/devices/{device_id}/commands, /v1/devices/commands/{command_id}/result, /v1/devices/redeem, /v1/devices/heartbeat  → same handlers as /v1/nodes/*; responses add device_id (= node id)
Control (POST commands, DELETE): device owner (the human who paired it) or the device's own token. Admin: DELETE (unpair) only. Everyone who can use an agent on it may read its status.
```
Agent identity on machine calls: the connector sends `X-Agent-Name: <agent>` on every request
it makes for a specific agent (events poll, files, knowledge, discover, tools).

## 5. Frontend contract

- Members page → tab **Groups**: list (builtin everyone/guest shown read-only with derived counts), create, rename, delete with impact preview, members (people + agents) add/remove.
- Reusable `components/sharing/grantee-picker.tsx`: props `{ value: Grantee[]; onChange(v: Grantee[]): void; kinds?: GranteeKind[]; exclude?: string[] }`, `Grantee = { kind: 'human'|'agent'|'group'; id: string; label: string }`, searches collaborators, agents, groups from workspace context / api.
- Share dialog (threads, agents): grantee picker with groups; share preview; expiry (agent grants).
- Thread header / info: owner, Private/Public wording, owner switch "participants can add people", "Make public / Make private" (owner), Join button on public threads you are not in. New-thread dialog defaults to private.
- Files pane: owner + visibility badge per file; "Share" (person / agent / group / public) from the file menu; Knowledge entries: same.
- Agent manage sheet: remove Personal/Team toggle; section "Who can use this agent": everyone switch, groups, people, agents; expiry per grant.
- Settings → Admin → Private threads: metadata table + Transfer owner action.
- "Why can I see this?" line (from /access/explain) in thread info, file info, knowledge entry view, agent profile.
- Wording: node → device everywhere in en-US and zh-CN (节点 → 设备). Type names in code may stay.
- Types: `SecurityGroup`, `GroupMember`, `ResourceGrant`, `AccessExplanation`; api wrappers `listGroups/createGroup/renameGroup/deleteGroup/listGroupMembers/addGroupMember/removeGroupMember/listGrants/createGrant/revokeGrant/previewGrant/explainAccess/updateChannelAccess/joinChannel/listPrivateThreadsAdmin/transferThread/updateFileVisibility`.

## 6. Out of scope for this slice (v1.2)
Per-device tokens; enforcing the requester-intersection rule on every read for agents (today:
inheritance + grants only); guest invitation UI; out-of-office delegate; browser logins as
grants; audit log UI; ownership transfer for files/knowledge/agents (API may land, UI later).
