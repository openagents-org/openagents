# -*- coding: utf-8 -*-
"""
Permission model v1.1 — HTTP contract (spec §4): groups CRUD + members, grants
(+ preview, explain, mine), thread PATCH / join / admin private-threads, files
and knowledge owner + visibility, agent directory `usable_by`, legacy shims.
"""

from datetime import datetime, timedelta, timezone

from app.models import Channel, ChannelHumanMember, EventRecord, ResourceGrant, SecurityGroup
from sqlalchemy import select

# Same people (adam admin, mia member, vic viewer), stubs and helpers as M1.
from tests.test_visibility import (  # noqa: F401
    _bearer, _create_thread, _discover, _join, _post, _revoke_everyone, _tok, no_push, people,
)

E = {n: f"{n}@acme.test" for n in ("adam", "mia", "vic")}


def _groups(client, ws, headers):
    r = client.get(f"/v1/groups?network={ws['id']}", headers=headers)
    assert r.status_code == 200, r.text
    return {g["slug"]: g for g in r.json()["data"]["groups"]}


def _new_group(client, ws, headers, name):
    return client.post("/v1/groups", json={"network": ws["id"], "name": name}, headers=headers)


def _add_member(client, ws, headers, gid, kind, pid):
    return client.post(f"/v1/groups/{gid}/members", json={"network": ws["id"], "principal_kind": kind, "principal_id": pid}, headers=headers)


def _grant(client, ws, headers, **body):
    return client.post("/v1/grants", json={"network": ws["id"], **body}, headers=headers)


def _grants(client, ws, headers, kind, rid):
    return client.get(f"/v1/grants?network={ws['id']}&resource_kind={kind}&resource_id={rid}", headers=headers)


def _explain(client, ws, headers, kind, rid, right="read"):
    r = client.get(f"/v1/access/explain?network={ws['id']}&resource_kind={kind}&resource_id={rid}&right={right}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _patch_thread(client, ws, headers, name, **body):
    return client.patch(f"/v1/channels/{name}", json={"network": ws["id"], **body}, headers=headers)


def _team(client, ws, *members):
    r = _new_group(client, ws, _bearer("adam", ws), "Deploy team")
    assert r.status_code == 200, r.text
    gid = r.json()["data"]["id"]
    for kind, pid in members:
        assert _add_member(client, ws, _bearer("adam", ws), gid, kind, pid).status_code == 200
    return gid


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------

class TestGroups:
    def test_builtins_and_crud(self, client, workspace, people, db):
        g = _groups(client, workspace, _bearer("vic", workspace))
        assert g["everyone"]["builtin"] is True and g["everyone"]["kind"] == "everyone"
        # 3 people + the creator + agent-alpha
        assert g["everyone"]["member_count"] == 5
        assert g["guest"]["member_count"] == 0 and g["guest"]["builtin"] is True
        # only admins mutate
        assert _new_group(client, workspace, _bearer("mia", workspace), "x").status_code == 403
        assert _new_group(client, workspace, _bearer("adam", workspace), "  ").status_code == 400
        r = _new_group(client, workspace, _bearer("adam", workspace), "Deploy team")
        assert r.status_code == 200, r.text
        grp = r.json()["data"]
        assert grp["slug"] == "deploy-team" and grp["kind"] == "custom" and grp["builtin"] is False and grp["member_count"] == 0
        # slug stays unique; builtin names cannot be squatted
        assert _new_group(client, workspace, _tok(workspace), "Deploy team").json()["data"]["slug"] == "deploy-team-2"
        assert _new_group(client, workspace, _tok(workspace), "everyone").json()["data"]["slug"] == "everyone-group"
        # rename
        r = client.patch(f"/v1/groups/{grp['id']}", json={"network": workspace["id"], "name": "Ship team"}, headers=_bearer("adam", workspace))
        assert r.status_code == 200 and r.json()["data"]["name"] == "Ship team" and r.json()["data"]["slug"] == "ship-team"
        assert client.patch(f"/v1/groups/{g['everyone']['id']}", json={"network": workspace["id"], "name": "x"},
                            headers=_bearer("adam", workspace)).status_code == 400
        assert client.patch(f"/v1/groups/{grp['id']}", json={"network": workspace["id"], "name": "x"},
                            headers=_bearer("vic", workspace)).status_code == 403
        assert client.patch(f"/v1/groups/nope", json={"network": workspace["id"], "name": "x"},
                            headers=_bearer("adam", workspace)).status_code == 404

    def test_members(self, client, workspace, people):
        gid = _team(client, workspace)
        adam = _bearer("adam", workspace)
        assert _add_member(client, workspace, adam, gid, "human", "VIC@acme.test").status_code == 200
        assert _add_member(client, workspace, adam, gid, "human", "vic@acme.test").json()["data"]["added"] is False
        assert _add_member(client, workspace, adam, gid, "agent", "agent-alpha").status_code == 200
        assert _add_member(client, workspace, adam, gid, "human", "nobody@acme.test").status_code == 400
        assert _add_member(client, workspace, adam, gid, "agent", "ghost").status_code == 404
        assert _add_member(client, workspace, adam, gid, "robot", "x").status_code == 400
        assert _add_member(client, workspace, _bearer("mia", workspace), gid, "human", "mia@acme.test").status_code == 403
        r = client.get(f"/v1/groups/{gid}/members?network={workspace['id']}", headers=_bearer("vic", workspace))
        assert r.status_code == 200, r.text
        members = r.json()["data"]["members"]
        assert [(m["principal_kind"], m["principal_id"], m["display_name"]) for m in members] == [
            ("human", "vic@acme.test", "Vic"), ("agent", "agent-alpha", "@agent-alpha")]
        assert members[0]["added_by"] == "adam@acme.test" and members[0]["created_at"]
        # derived builtin membership is read-only
        everyone = _groups(client, workspace, adam)["everyone"]
        assert _add_member(client, workspace, adam, everyone["id"], "human", "vic@acme.test").status_code == 400
        r = client.get(f"/v1/groups/{everyone['id']}/members?network={workspace['id']}", headers=adam)
        kinds = {(m["principal_kind"], m["principal_id"]) for m in r.json()["data"]["members"]}
        assert ("human", "vic@acme.test") in kinds and ("agent", "agent-alpha") in kinds
        # remove
        assert client.delete(f"/v1/groups/{gid}/members/agent/agent-alpha?network={workspace['id']}", headers=adam).status_code == 200
        assert client.delete(f"/v1/groups/{gid}/members/agent/agent-alpha?network={workspace['id']}", headers=adam).status_code == 404
        assert _groups(client, workspace, adam)["deploy-team"]["member_count"] == 1

    def test_delete_with_impact(self, client, workspace, people, db):
        gid = _team(client, workspace, ("human", E["vic"]))
        _create_thread(client, workspace, name="t-1", by="mia")
        r = _grant(client, workspace, _bearer("mia", workspace), resource_kind="channel", resource_id="t-1", grantee_kind="group", grantee_id=gid)
        assert r.status_code == 200, r.text
        adam = _bearer("adam", workspace)
        assert client.delete(f"/v1/groups/{gid}?network={workspace['id']}", headers=_bearer("mia", workspace)).status_code == 403
        r = client.delete(f"/v1/groups/{gid}?network={workspace['id']}&dry_run=1", headers=adam)
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["affected_grants"] == 1 and d["members"] == 1 and d["deleted"] is False
        assert "t-1" in _discover(client, workspace, _bearer("vic", workspace))[0]
        r = client.delete(f"/v1/groups/{gid}?network={workspace['id']}", headers=adam)
        assert r.json()["data"]["deleted"] is True
        assert "t-1" not in _discover(client, workspace, _bearer("vic", workspace))[0]
        assert db.execute(select(SecurityGroup).where(SecurityGroup.id == gid)).scalar_one_or_none() is None
        g = db.execute(select(ResourceGrant).where(ResourceGrant.grantee_id == gid)).scalar_one()
        assert g.revoked_at is not None and g.revoked_by == "adam@acme.test"
        everyone = _groups(client, workspace, adam)["everyone"]
        assert client.delete(f"/v1/groups/{everyone['id']}?network={workspace['id']}", headers=adam).status_code == 400


# ---------------------------------------------------------------------------
# Grants, preview, explain, mine
# ---------------------------------------------------------------------------

class TestGrants:
    def test_thread_grants_to_group_agent_and_person(self, client, workspace, people, db):
        _join(client, workspace, "helper-bot")
        gid = _team(client, workspace, ("human", E["vic"]))
        _create_thread(client, workspace, name="g-1", by="mia")
        mia, vic, adam = _bearer("mia", workspace), _bearer("vic", workspace), _bearer("adam", workspace)
        assert "g-1" not in _discover(client, workspace, vic)[0]
        # only a manager grants (owner mia yes, admin yes, vic no)
        assert _grant(client, workspace, vic, resource_kind="channel", resource_id="g-1", grantee_kind="group", grantee_id=gid).status_code == 403
        assert _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="group", grantee_id="nope").status_code == 404
        assert _grant(client, workspace, mia, resource_kind="bogus", resource_id="g-1", grantee_kind="group", grantee_id=gid).status_code == 400
        assert _grant(client, workspace, mia, resource_kind="channel", resource_id="ghost", grantee_kind="group", grantee_id=gid).status_code == 404
        assert _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="group", grantee_id=gid,
                      rights=["read", "fly"]).status_code == 400
        assert _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="group", grantee_id=gid,
                      expires_at="2001-01-01T00:00:00Z").status_code == 400
        r = _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="group", grantee_id=gid)
        assert r.status_code == 200, r.text
        g = r.json()["data"]
        assert g["grantee_label"] == "Deploy team" and g["rights"] == ["read", "act"] and g["created"] is True
        assert g["granted_by"] == "mia@acme.test"
        # idempotent
        assert _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="group", grantee_id=gid).json()["data"]["created"] is False
        assert "g-1" in _discover(client, workspace, vic)[0]
        ex = _explain(client, workspace, vic, "channel", "g-1")
        assert ex["allowed"] is True and ex["reason"] == "group:Deploy team"
        assert _explain(client, workspace, mia, "channel", "g-1")["reason"] == "owner"
        assert _explain(client, workspace, adam, "channel", "g-1")["reason"] == "admin_metadata"
        assert _explain(client, workspace, _tok(workspace), "channel", "g-1")["reason"] == "machine"
        # events read follows (search included)
        assert _post(client, workspace, channel="g-1", by="mia", content="launch codes", headers=mia).status_code == 200
        r = client.get(f"/v1/events?network={workspace['id']}&channel=g-1", headers=vic)
        assert r.status_code == 200 and any("launch" in (e["payload"] or {}).get("content", "") for e in r.json()["data"]["events"])
        # grant to an agent: the agent (identified by header) sees the thread
        hb = {**_tok(workspace), "X-Agent-Name": "helper-bot"}
        assert "g-1" not in _discover(client, workspace, hb)[0]
        r = _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="agent", grantee_id="helper-bot",
                   expires_at=(datetime.now(timezone.utc) + timedelta(days=7)).isoformat(), note="for deploys")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["expires_at"] and r.json()["data"]["note"] == "for deploys"
        assert "g-1" in _discover(client, workspace, hb)[0]
        assert _explain(client, workspace, hb, "channel", "g-1")["reason"] == "grant"
        # list
        r = _grants(client, workspace, mia, "channel", "g-1")
        assert r.status_code == 200 and {(x["grantee_kind"], x["grantee_label"]) for x in r.json()["data"]["grants"]} == {
            ("group", "Deploy team"), ("agent", "@helper-bot")}
        assert _grants(client, workspace, vic, "channel", "g-1").status_code == 403
        # revoke: vic cannot, owner can; access goes away
        gid_grant = next(x["id"] for x in r.json()["data"]["grants"] if x["grantee_kind"] == "group")
        assert client.delete(f"/v1/grants/{gid_grant}?network={workspace['id']}", headers=vic).status_code == 403
        assert client.delete(f"/v1/grants/{gid_grant}?network={workspace['id']}", headers=mia).status_code == 200
        assert "g-1" not in _discover(client, workspace, vic)[0]
        assert _explain(client, workspace, vic, "channel", "g-1")["reason"] == "denied"
        assert client.delete(f"/v1/grants/nope?network={workspace['id']}", headers=mia).status_code == 404
        # non-member humans are refused (invites are the sharing router's job)
        assert _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="human", grantee_id="zoe@acme.test").status_code == 400
        assert _grant(client, workspace, mia, resource_kind="channel", resource_id="g-1", grantee_kind="human", grantee_id="vic@acme.test").status_code == 200
        assert _explain(client, workspace, vic, "channel", "g-1")["reason"] == "grant"

    def test_preview_and_mine(self, client, workspace, people):
        gid = _team(client, workspace, ("human", E["vic"]))
        _create_thread(client, workspace, name="pv-1", by="mia")
        mia, vic = _bearer("mia", workspace), _bearer("vic", workspace)
        r = client.get(f"/v1/grants/preview?network={workspace['id']}&resource_kind=channel&resource_id=pv-1&grantee_kind=group&grantee_id={gid}", headers=mia)
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["items"][0] == {"kind": "channel", "id": "pv-1", "title": "pv-1"}
        assert d["grantee"] == {"kind": "group", "id": gid, "label": "Deploy team"}
        assert client.get(f"/v1/grants/preview?network={workspace['id']}&resource_kind=channel&resource_id=pv-1", headers=vic).status_code == 403
        r = client.get(f"/v1/grants/preview?network={workspace['id']}&resource_kind=agent&resource_id=agent-alpha", headers=_tok(workspace))
        assert r.json()["data"]["items"][0]["kind"] == "agent"
        _grant(client, workspace, mia, resource_kind="channel", resource_id="pv-1", grantee_kind="group", grantee_id=gid)
        r = client.get(f"/v1/access/mine?network={workspace['id']}", headers=vic)
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["principal"]["email"] == "vic@acme.test" and d["principal"]["role"] == "viewer"
        assert {g["name"] for g in d["groups"]} == {"Everyone", "Deploy team"}
        kinds = {(g["resource_kind"], g["resource_id"], g["via"]) for g in d["grants"]}
        assert ("channel", "pv-1", "group") in kinds and ("agent", "agent-alpha", "group") in kinds
        r = client.get(f"/v1/access/candidates?network={workspace['id']}", headers=vic)
        d = r.json()["data"]
        assert {h["id"] for h in d["humans"]} >= {E["adam"], E["mia"], E["vic"]}
        assert [g["label"] for g in d["groups"]][:2] == ["Everyone", "Guests"] and d["agents"][0]["id"] == "agent-alpha"


# ---------------------------------------------------------------------------
# Threads: PATCH / join / participants switch / admin list
# ---------------------------------------------------------------------------

class TestThreadAccess:
    def test_owner_switches_and_join(self, client, workspace, people, db):
        _create_thread(client, workspace, name="th-1", by="mia")
        mia, vic, adam = _bearer("mia", workspace), _bearer("vic", workspace), _bearer("adam", workspace)
        ch = db.execute(select(Channel).where(Channel.name == "th-1")).scalar_one()
        assert ch.visibility == "private" and ch.owner_email == "mia@acme.test" and ch.participants_can_invite is False
        # participants carry owner + switch
        p = client.get(f"/v1/channels/th-1/participants?network={workspace['id']}", headers=mia).json()["data"]
        assert p["owner_email"] == "mia@acme.test" and p["participants_can_invite"] is False and p["visibility"] == "private"
        # vic cannot see it, so cannot patch it; cannot join a private thread either
        assert _patch_thread(client, workspace, vic, "th-1", visibility="public").status_code == 404
        assert client.post("/v1/channels/th-1/join", json={"network": workspace["id"]}, headers=vic).status_code == 403
        # alias + owner rule
        assert _patch_thread(client, workspace, mia, "th-1", visibility="bogus").status_code == 400
        r = _patch_thread(client, workspace, mia, "th-1", visibility="workspace")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["visibility"] == "public" and r.json()["data"]["changed"] == {"visibility": "public"}
        assert "th-1" in _discover(client, workspace, vic)[0]
        assert _explain(client, workspace, vic, "channel", "th-1")["reason"] == "public"
        # self-join adds the ACL row
        r = client.post("/v1/channels/th-1/join", json={"network": workspace["id"]}, headers=vic)
        assert r.status_code == 200 and r.json()["data"]["already_participant"] is False
        assert client.post("/v1/channels/th-1/join", json={"network": workspace["id"]}, headers=vic).json()["data"]["already_participant"] is True
        assert client.post("/v1/channels/th-1/join", json={"network": workspace["id"]}, headers=_tok(workspace)).status_code == 400
        assert "vic@acme.test" in set(db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == ch.id)).scalars().all())
        # a participant (vic) may not flip visibility; the owner locks it again and stays in
        assert _patch_thread(client, workspace, vic, "th-1", visibility="private").status_code == 403
        assert _patch_thread(client, workspace, mia, "th-1", visibility="private").status_code == 200
        assert _explain(client, workspace, vic, "channel", "th-1")["reason"] == "participant"
        # participants_can_invite: off → vic cannot add adam; on → can
        body = {"network": workspace["id"], "email": E["adam"]}
        assert client.post("/v1/channels/th-1/participants", json=body, headers=vic).status_code == 403
        assert _patch_thread(client, workspace, vic, "th-1", participants_can_invite=True).status_code == 403
        r = _patch_thread(client, workspace, mia, "th-1", participants_can_invite=True)
        assert r.status_code == 200 and r.json()["data"]["participants_can_invite"] is True
        assert client.post("/v1/channels/th-1/participants", json=body, headers=vic).status_code == 200
        assert "th-1" in _discover(client, workspace, adam)[0]

    def test_transfer_and_admin_metadata(self, client, workspace, people, db):
        _create_thread(client, workspace, name="tr-1", by="mia")
        _create_thread(client, workspace, name="open-1", by="mia", visibility="public")
        mia, vic, adam = _bearer("mia", workspace), _bearer("vic", workspace), _bearer("adam", workspace)
        assert _post(client, workspace, channel="tr-1", by="mia", content="one", headers=mia).status_code == 200
        assert _post(client, workspace, channel="tr-1", by="mia", content="two", headers=mia).status_code == 200
        # admin: metadata list, never the content
        assert client.get(f"/v1/admin/private-threads?network={workspace['id']}", headers=mia).status_code == 403
        r = client.get(f"/v1/admin/private-threads?network={workspace['id']}", headers=adam)
        assert r.status_code == 200, r.text
        threads = {t["name"]: t for t in r.json()["data"]["threads"]}
        assert set(threads) == {"tr-1"}
        t = threads["tr-1"]
        assert t["owner_email"] == "mia@acme.test" and t["participant_count"] == 1 and t["message_count"] == 2
        assert t["title"] == "tr-1" and "last_activity_at" in t
        assert client.get(f"/v1/events?network={workspace['id']}&channel=tr-1", headers=adam).status_code == 403
        # hand-over: only the owner (or admin) — the new owner must be a member
        assert _patch_thread(client, workspace, mia, "tr-1", owner_email="zoe@acme.test").status_code == 400
        assert _patch_thread(client, workspace, mia, "tr-1", owner_email="not-an-email").status_code == 400
        r = _patch_thread(client, workspace, mia, "tr-1", owner_email="VIC@acme.test")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["owner_email"] == "vic@acme.test" and r.json()["data"]["changed"] == {"owner_email": "vic@acme.test"}
        assert _explain(client, workspace, vic, "channel", "tr-1")["reason"] == "owner"
        assert _explain(client, workspace, mia, "channel", "tr-1")["reason"] == "participant", "the previous owner stays a participant"
        evt = db.execute(select(EventRecord).where(EventRecord.type == "network.channel.transfer")).scalar_one()
        assert evt.payload["from"] == "mia@acme.test" and evt.payload["to"] == "vic@acme.test" and evt.payload["forced"] is False
        # mia is no longer the owner → cannot transfer back; admin forces it
        assert _patch_thread(client, workspace, mia, "tr-1", owner_email=E["mia"]).status_code == 403
        r = _patch_thread(client, workspace, adam, "tr-1", owner_email=E["mia"])
        assert r.status_code == 200, r.text
        forced = db.execute(select(EventRecord).where(EventRecord.type == "network.channel.transfer")).scalars().all()
        assert len(forced) == 2 and forced[-1].payload["forced"] is True and forced[-1].payload["by"] == "adam@acme.test"
        # admin still cannot read it
        assert client.get(f"/v1/events?network={workspace['id']}&channel=tr-1", headers=adam).status_code == 403
        # discover exposes the new fields
        d = client.get(f"/v1/discover?network={workspace['id']}", headers=mia).json()["data"]
        ch = next(c for c in d["channels"] if c["address"] == "channel/tr-1")
        assert ch["visibility"] == "private" and ch["owner_email"] == "mia@acme.test" and ch["participants_can_invite"] is False
        assert next(c for c in d["channels"] if c["address"] == "channel/open-1")["visibility"] == "public"

    def test_groups_on_create_and_legacy_alias(self, client, workspace, people, db):
        gid = _team(client, workspace, ("human", E["vic"]))
        r = client.post("/v1/events", json={
            "type": "network.channel.create", "source": "human:mia", "target": "core", "network": workspace["id"],
            "payload": {"name": "gc-1", "title": "gc-1", "sender_email": E["mia"], "participants": ["agent-alpha"], "groups": [gid, "bogus"]},
        }, headers=_tok(workspace))
        assert r.status_code == 200, r.text
        assert r.json()["data"]["metadata"]["visibility"] == "private"
        assert "gc-1" in _discover(client, workspace, _bearer("vic", workspace))[0]
        assert "gc-1" not in _discover(client, workspace, _bearer("adam", workspace))[0]
        # legacy 'workspace' alias → public; agent-created threads stay public
        _create_thread(client, workspace, name="alias-1", by="mia", visibility="workspace")
        assert db.execute(select(Channel).where(Channel.name == "alias-1")).scalar_one().visibility == "public"
        r = client.post("/v1/events", json={
            "type": "network.channel.create", "source": "openagents:agent-alpha", "target": "core", "network": workspace["id"],
            "payload": {"name": "bot-1", "title": "bot-1", "participants": ["agent-alpha"]},
        }, headers=_tok(workspace))
        assert r.status_code == 200, r.text
        bot = db.execute(select(Channel).where(Channel.name == "bot-1")).scalar_one()
        assert bot.visibility == "public" and bot.owner_email is None
        # the old per-workspace PATCH accepts the alias too and emits 'public'
        r = client.patch(f"/v1/workspaces/{workspace['id']}/channels/gc-1", json={"visibility": "workspace"}, headers=_bearer("mia", workspace))
        assert r.status_code == 200, r.text
        assert r.json()["data"]["visibility"] == "public" and r.json()["data"]["ownerEmail"] == "mia@acme.test"


# ---------------------------------------------------------------------------
# Files & knowledge
# ---------------------------------------------------------------------------

def _upload(client, ws, headers, name="a.txt", **data):
    return client.post("/v1/files", files={"file": (name, b"hello", "text/plain")},
                       data={"network": ws["id"], **data}, headers=headers)


def _short(filename: str) -> str:
    """POST /files organises uploads as uploaded_files/<YYYYMMDD_HHMMSS>_<name>."""
    import re
    return re.sub(r"^\d{8}_\d{6}_", "", filename.rsplit("/", 1)[-1])


def _file_ids(client, ws, headers, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    r = client.get(f"/v1/files?network={ws['id']}&{q}", headers=headers)
    assert r.status_code == 200, r.text
    return {_short(f["filename"]): f for f in r.json()["data"]["files"]}


class TestFiles:
    def test_owner_visibility_and_grants(self, client, workspace, people, db):
        mia, vic, adam = _bearer("mia", workspace), _bearer("vic", workspace), _bearer("adam", workspace)
        # a person's unattached upload is private to them by default
        r = _upload(client, workspace, mia, "mine.txt")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["owner"] == "human:mia@acme.test" and d["owner_label"] == "mia@acme.test"
        assert d["visibility"] == "private" and d["effective_visibility"] == "private" and d["can_manage"] is True
        fid = d["id"]
        # legacy machine upload stays public; explicit visibility honoured
        assert _upload(client, workspace, _tok(workspace), "legacy.txt", source="human:user").json()["data"]["visibility"] == "public"
        assert _upload(client, workspace, mia, "shared.txt", visibility="public").json()["data"]["visibility"] == "public"
        assert "mine.txt" not in _file_ids(client, workspace, vic)
        assert "mine.txt" not in _file_ids(client, workspace, adam), "admins see metadata only — not private files"
        assert {"legacy.txt", "shared.txt"} <= set(_file_ids(client, workspace, vic))
        assert "mine.txt" in _file_ids(client, workspace, _tok(workspace))
        assert client.get(f"/v1/files/{fid}/info", headers=vic).status_code == 403
        assert client.get(f"/v1/files/{fid}", headers=vic).status_code == 403
        assert client.get(f"/v1/files/{fid}/info", headers=mia).status_code == 200
        r = client.get(f"/v1/files/browse?network={workspace['id']}&recursive=true", headers=vic)
        assert "mine.txt" not in {_short(f["filename"]) for f in r.json()["data"]["files"]}
        # grant to vic → visible; explain says so
        assert _grant(client, workspace, vic, resource_kind="file", resource_id=fid, grantee_kind="human", grantee_id=E["vic"]).status_code == 403
        assert _grant(client, workspace, mia, resource_kind="file", resource_id=fid, grantee_kind="human", grantee_id=E["vic"]).status_code == 200
        assert "mine.txt" in _file_ids(client, workspace, vic)
        assert client.get(f"/v1/files/{fid}", headers=vic).status_code == 200
        assert _explain(client, workspace, vic, "file", fid)["reason"] == "grant"
        assert _file_ids(client, workspace, vic)["mine.txt"]["can_manage"] is False
        # PATCH visibility: owner/admin only
        assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=vic).status_code == 403
        assert client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "inherit"}, headers=mia).status_code == 400
        r = client.patch(f"/v1/files/{fid}", json={"network": workspace["id"], "visibility": "public"}, headers=adam)
        assert r.status_code == 200 and r.json()["data"]["visibility"] == "public"
        assert "mine.txt" in _file_ids(client, workspace, adam)

    def test_files_in_a_thread_inherit(self, client, workspace, people):
        _create_thread(client, workspace, name="ft-1", by="mia")
        mia, vic = _bearer("mia", workspace), _bearer("vic", workspace)
        d = _upload(client, workspace, mia, "att.txt", channel_name="ft-1").json()["data"]
        assert d["visibility"] is None and d["effective_visibility"] == "private"
        assert "att.txt" not in _file_ids(client, workspace, vic)
        assert _patch_thread(client, workspace, mia, "ft-1", visibility="public").status_code == 200
        assert "att.txt" in _file_ids(client, workspace, vic)
        assert _file_ids(client, workspace, vic)["att.txt"]["effective_visibility"] == "public"
        assert _explain(client, workspace, vic, "file", d["id"])["reason"] == "inherited_from_channel"
        # an identified agent owns what it uploads; its owner can manage it
        _join(client, workspace, "deploy-bot")
        client.patch(f"/v1/workspaces/{workspace['id']}/members/deploy-bot", json={"owner_email": E["mia"]}, headers=mia)
        d = _upload(client, workspace, {**_tok(workspace), "X-Agent-Name": "deploy-bot"}, "bot.txt").json()["data"]
        assert d["owner"] == "openagents:deploy-bot" and d["owner_label"] == "@deploy-bot" and d["visibility"] == "private"
        assert "bot.txt" in _file_ids(client, workspace, mia) and "bot.txt" not in _file_ids(client, workspace, vic)
        assert _explain(client, workspace, mia, "file", d["id"])["reason"] == "owner"
        # the agent itself may share its artifact
        r = _grant(client, workspace, {**_tok(workspace), "X-Agent-Name": "deploy-bot"},
                   resource_kind="file", resource_id=d["id"], grantee_kind="human", grantee_id=E["vic"])
        assert r.status_code == 200, r.text
        assert "bot.txt" in _file_ids(client, workspace, vic)


class TestKnowledge:
    def test_owner_visibility_and_edit_rights(self, client, workspace, people):
        mia, vic, adam = _bearer("mia", workspace), _bearer("vic", workspace), _bearer("adam", workspace)
        r = client.post("/v1/knowledge", json={"network": workspace["id"], "title": "Runbook", "content": "# secret"}, headers=mia)
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["owner"] == "human:mia@acme.test" and d["visibility"] == "private" and d["can_manage"] is True
        kid, slug = d["id"], d["slug"]
        pub = client.post("/v1/knowledge", json={"network": workspace["id"], "title": "Public", "content": "x", "visibility": "public"}, headers=mia).json()["data"]
        legacy = client.post("/v1/knowledge", json={"network": workspace["id"], "title": "Legacy", "content": "x", "source": "human:user"}, headers=_tok(workspace)).json()["data"]
        assert pub["visibility"] == "public" and legacy["visibility"] == "public" and legacy["owner"] == "human:user"
        titles = lambda h: {e["title"] for e in client.get(f"/v1/knowledge?network={workspace['id']}", headers=h).json()["data"]["entries"]}  # noqa: E731
        assert titles(vic) == {"Public", "Legacy"} and titles(adam) == {"Public", "Legacy"}
        assert titles(mia) == {"Runbook", "Public", "Legacy"} and titles(_tok(workspace)) == {"Runbook", "Public", "Legacy"}
        assert client.get(f"/v1/knowledge/{kid}", headers=vic).status_code == 403
        assert client.get(f"/v1/knowledge/by-slug/{slug}?network={workspace['id']}", headers=vic).status_code == 403
        assert client.get(f"/v1/knowledge/{kid}", headers=mia).json()["data"]["content"] == "# secret"
        # edit needs act; visibility needs a manager
        upd = lambda h, **b: client.put(f"/v1/knowledge/{kid}", json={"network": workspace["id"], **b}, headers=h)  # noqa: E731
        assert upd(vic, content="hack").status_code == 403
        assert _grant(client, workspace, mia, resource_kind="knowledge", resource_id=kid, grantee_kind="human", grantee_id=E["vic"], rights=["read"]).status_code == 200
        assert client.get(f"/v1/knowledge/{kid}", headers=vic).status_code == 200
        assert upd(vic, content="hack").status_code == 403, "read-only grant"
        _grant(client, workspace, mia, resource_kind="knowledge", resource_id=kid, grantee_kind="human", grantee_id=E["vic"], rights=["read", "act"])
        assert upd(vic, content="edited by vic").status_code == 200
        assert upd(vic, visibility="public").status_code == 403
        r = upd(mia, visibility="public")
        assert r.status_code == 200 and r.json()["data"]["visibility"] == "public"
        assert "Runbook" in titles(adam)
        assert _explain(client, workspace, adam, "knowledge", kid)["reason"] == "public"
        assert client.delete(f"/v1/knowledge/{pub['id']}?network={workspace['id']}", headers=vic).status_code == 200


# ---------------------------------------------------------------------------
# Agents: directory usable_by, deprecated flag, legacy shims
# ---------------------------------------------------------------------------

class TestAgentsUsableBy:
    def test_directory_and_shims(self, client, workspace, people, db):
        _join(client, workspace, "deploy-bot")
        mia, vic = _bearer("mia", workspace), _bearer("vic", workspace)
        client.patch(f"/v1/workspaces/{workspace['id']}/members/deploy-bot", json={"owner_email": E["mia"], "visibility": "personal"}, headers=mia)
        directory = lambda h: {a["agent_name"]: a for a in client.get(f"/v1/agents/directory?network={workspace['id']}", headers=h).json()["data"]["agents"]}  # noqa: E731
        bot = directory(vic)["deploy-bot"]
        assert bot["usable_by"] == {"everyone": True, "groups": [], "people": 0, "agents": 0}
        assert bot["visibility"] == "team", "the deprecated flag mirrors the everyone grant, PATCH ignored it"
        _revoke_everyone(client, workspace, "deploy-bot", mia)
        assert "deploy-bot" not in directory(vic)
        gid = _team(client, workspace, ("human", E["vic"]))
        assert _grant(client, workspace, mia, resource_kind="agent", resource_id="deploy-bot", grantee_kind="group", grantee_id=gid, rights=["act"]).status_code == 200
        bot = directory(vic)["deploy-bot"]
        assert bot["visibility"] == "personal" and bot["usable_by"] == {"everyone": False, "groups": [{"id": gid, "name": "Deploy team"}], "people": 0, "agents": 0}
        assert client.post(f"/v1/agents/deploy-bot/requests", json={"network": workspace["id"], "content": "hi"}, headers=vic).status_code == 200
        # legacy shims write resource_grants
        r = client.post("/v1/agents/deploy-bot/grants", json={"network": workspace["id"], "email": E["adam"]}, headers=mia)
        assert r.status_code == 200 and r.json()["data"]["granted"] is True
        g = db.execute(select(ResourceGrant).where(ResourceGrant.grantee_kind == "human")).scalar_one()
        assert (g.resource_kind, g.resource_id, g.grantee_id, g.rights) == ("agent", "deploy-bot", "adam@acme.test", ["read", "act"])
        r = client.get(f"/v1/agents/deploy-bot/grants?network={workspace['id']}", headers=mia)
        assert [x["email"] for x in r.json()["data"]["grants"]] == ["adam@acme.test"]
        assert directory(mia)["deploy-bot"]["grant_count"] == 1 and directory(mia)["deploy-bot"]["usable_by"]["people"] == 1
        assert client.delete(f"/v1/agents/deploy-bot/grants/{E['adam']}?network={workspace['id']}", headers=mia).status_code == 200
        db.expire_all()
        assert g.revoked_at is not None
        # explain for an agent
        assert _explain(client, workspace, vic, "agent", "deploy-bot", right="act")["reason"] == "group:Deploy team"
        assert _explain(client, workspace, mia, "agent", "deploy-bot", right="act")["reason"] == "owner"
