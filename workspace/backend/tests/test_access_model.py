# -*- coding: utf-8 -*-
"""
Permission model v1.1 — the access rule table (app/services/access_model.py).

    owner / public / participant / direct grant / group grant / agent
    inheritance / guest on public / admin denied on private / machine legacy,
    for threads, agents, files and knowledge; plus principal resolution and the
    default `everyone` grant every new agent gets.
"""

from datetime import datetime, timedelta, timezone

import pytest
from app.models import (
    Channel,
    ChannelHumanMember,
    ChannelMember,
    FileRecord,
    KnowledgeEntry,
    ResourceGrant,
    SecurityGroup,
    SecurityGroupMember,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMembership,
)
from app.services import access_model as am
from sqlalchemy import select


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def world(db, workspace):
    """A workspace with people of every role, two agents (one owned by Mia),
    the builtin groups and one custom group containing Vic."""
    wid = workspace["id"]
    people = {}
    for name, role in (("adam", "admin"), ("mia", "member"), ("vic", "viewer"), ("gus", "guest")):
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=wid, user_id=user.id, role=role))
        people[name] = am.Principal("human", email=email, role=role, workspace_id=wid)
    db.add(WorkspaceMember(workspace_id=wid, agent_name="deploy-bot", agent_type="claude", status="online",
                           owner_email="mia@acme.test"))
    db.add(WorkspaceMember(workspace_id=wid, agent_name="orphan-bot", agent_type="claude", status="online"))
    db.flush()
    groups = am.get_or_create_builtin_groups(db, wid)
    team = SecurityGroup(workspace_id=wid, name="Deploy team", slug="deploy-team", kind="custom", created_by="adam@acme.test")
    db.add(team)
    db.flush()
    db.add(SecurityGroupMember(group_id=team.id, principal_kind="human", principal_id="vic@acme.test"))
    db.commit()
    return {
        "wid": wid,
        "ws": db.execute(select(Workspace).where(Workspace.id == wid)).scalar_one(),
        **people,
        "machine": am.Principal("machine", workspace_id=wid),
        "anon": am.Principal("human", email=None, workspace_id=wid),
        "deploy_bot": am.Principal("agent", agent_name="deploy-bot", owner_email="mia@acme.test", workspace_id=wid),
        "orphan_bot": am.Principal("agent", agent_name="orphan-bot", workspace_id=wid),
        "everyone": groups["everyone"],
        "guest_group": groups["guest"],
        "team": team,
    }


def _channel(db, wid, name, *, owner=None, visibility="private", humans=(), agents=()):
    ch = Channel(workspace_id=wid, name=name, title=name, visibility=visibility, owner_email=owner, status="active")
    db.add(ch)
    db.flush()
    for e in humans:
        db.add(ChannelHumanMember(channel_id=ch.id, user_email=e))
    for a in agents:
        db.add(ChannelMember(channel_id=ch.id, agent_name=a))
    db.commit()
    return ch


def _grant(db, wid, kind, rid, gkind, gid, rights=("read", "act"), **kw):
    g = ResourceGrant(workspace_id=wid, resource_kind=kind, resource_id=rid, grantee_kind=gkind, grantee_id=gid,
                      rights=list(rights), granted_by="test", **kw)
    db.add(g)
    db.commit()
    return g


def _file(db, wid, name, *, owner, visibility, channel=None):
    f = FileRecord(workspace_id=wid, filename=name, content_type="text/plain", size=1, storage_key=f"k/{name}",
                   uploaded_by=owner, owner=owner, visibility=visibility, channel_name=channel)
    db.add(f)
    db.commit()
    return f


def _knowledge(db, wid, slug, *, owner, visibility):
    k = KnowledgeEntry(workspace_id=wid, slug=slug, title=slug, created_by=owner, owner=owner, visibility=visibility)
    db.add(k)
    db.commit()
    return k


def _ex(db, p, res, right="read"):
    return am.explain(db, p, res, right)


# ---------------------------------------------------------------------------
# Threads
# ---------------------------------------------------------------------------

class TestThreads:
    def test_owner_public_participant_admin_machine(self, db, world):
        w = world
        private = am.resource_for_channel(_channel(db, w["wid"], "p", owner="mia@acme.test", humans=["mia@acme.test", "vic@acme.test"]))
        public = am.resource_for_channel(_channel(db, w["wid"], "o", owner="mia@acme.test", visibility="public"))

        assert _ex(db, w["mia"], private).reason == "owner"
        assert _ex(db, w["vic"], private).reason == "participant"
        e = _ex(db, w["adam"], private)
        assert e.allowed is False and e.reason == "admin_metadata", "admins see metadata only, never read"
        assert _ex(db, w["gus"], private).reason == "denied"
        assert _ex(db, w["machine"], private).reason == "machine"
        # public: every collaborator incl. guests, even an anonymous visitor
        assert _ex(db, w["gus"], public).reason == "public"
        assert _ex(db, w["anon"], public).reason == "public"
        assert _ex(db, w["anon"], private).allowed is False
        # share right is never implied by public
        assert _ex(db, w["gus"], public, "share").allowed is False
        # admins manage (transfer / grants) but still cannot read
        assert am.can_manage(db, w["adam"], private) is True
        assert am.can_manage(db, w["vic"], private) is False

    def test_direct_group_and_everyone_grants(self, db, world):
        w = world
        ch = _channel(db, w["wid"], "g", owner="mia@acme.test", humans=["mia@acme.test"])
        res = am.resource_for_channel(ch)
        assert _ex(db, w["vic"], res).allowed is False
        g = _grant(db, w["wid"], "channel", "g", "human", "vic@acme.test")
        assert _ex(db, w["vic"], res).reason == "grant"
        am.revoke_grant(db, g, "mia@acme.test")
        db.commit()
        assert _ex(db, w["vic"], res).allowed is False
        # expired grant is dead
        _grant(db, w["wid"], "channel", "g", "human", "vic@acme.test",
               expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        assert _ex(db, w["vic"], res).allowed is False
        # group grant (Vic is in Deploy team)
        _grant(db, w["wid"], "channel", "g", "group", w["team"].id)
        assert _ex(db, w["vic"], res).reason == "group:Deploy team"
        assert _ex(db, w["gus"], res).allowed is False
        # everyone grant reaches guests too
        _grant(db, w["wid"], "channel", "g", "group", w["everyone"].id, rights=("read",))
        assert _ex(db, w["gus"], res).reason == "group:Everyone"
        assert _ex(db, w["gus"], res, "act").allowed is False, "a read-only grant does not give act"
        # guest group reaches the guest, not the member
        ch2 = _channel(db, w["wid"], "g2", owner="mia@acme.test")
        _grant(db, w["wid"], "channel", "g2", "group", w["guest_group"].id)
        assert _ex(db, w["gus"], am.resource_for_channel(ch2)).reason == "group:Guests"
        assert _ex(db, w["vic"], am.resource_for_channel(ch2)).allowed is False

    def test_agent_inheritance_and_participation(self, db, world):
        w = world
        mine = am.resource_for_channel(_channel(db, w["wid"], "mine", owner="mia@acme.test", humans=["mia@acme.test"]))
        # the agent Mia owns sees what Mia sees …
        assert _ex(db, w["deploy_bot"], mine).reason == "inherited_from_owner"
        # … an unowned agent does not
        assert _ex(db, w["orphan_bot"], mine).allowed is False
        # unless it is a participant
        joined = am.resource_for_channel(_channel(db, w["wid"], "joined", owner="adam@acme.test", agents=["orphan-bot"]))
        assert _ex(db, w["orphan_bot"], joined).reason == "participant"
        # or granted directly / via a group that contains it
        other = _channel(db, w["wid"], "other", owner="adam@acme.test")
        _grant(db, w["wid"], "channel", "other", "agent", "orphan-bot")
        assert _ex(db, w["orphan_bot"], am.resource_for_channel(other)).reason == "grant"
        third = _channel(db, w["wid"], "third", owner="adam@acme.test")
        db.add(SecurityGroupMember(group_id=w["team"].id, principal_kind="agent", principal_id="orphan-bot"))
        db.commit()
        _grant(db, w["wid"], "channel", "third", "group", w["team"].id)
        # (group membership is cached per Principal — i.e. per request — so resolve afresh)
        fresh = am.Principal("agent", agent_name="orphan-bot", workspace_id=w["wid"])
        assert _ex(db, fresh, am.resource_for_channel(third)).reason == "group:Deploy team"
        # a grant to the owner is inherited by the agent (labelled as such)
        fourth = _channel(db, w["wid"], "fourth", owner="adam@acme.test")
        _grant(db, w["wid"], "channel", "fourth", "human", "mia@acme.test")
        assert _ex(db, w["deploy_bot"], am.resource_for_channel(fourth)).reason == "inherited_from_owner"

    def test_hidden_channel_names_matches_the_rule(self, db, world):
        w = world
        _channel(db, w["wid"], "a", owner="mia@acme.test", humans=["mia@acme.test"])
        _channel(db, w["wid"], "b", owner="adam@acme.test", humans=["adam@acme.test", "vic@acme.test"])
        _channel(db, w["wid"], "c", owner="adam@acme.test", visibility="public")
        _channel(db, w["wid"], "d", owner="adam@acme.test", agents=["orphan-bot"])
        _grant(db, w["wid"], "channel", "d", "group", w["team"].id)
        assert am.hidden_channel_names(db, w["wid"], w["mia"]) == {"b", "d"}
        assert am.hidden_channel_names(db, w["wid"], w["vic"]) == {"a"}
        assert am.hidden_channel_names(db, w["wid"], w["adam"]) == {"a"}  # adam owns b and d
        assert am.hidden_channel_names(db, w["wid"], w["gus"]) == {"a", "b", "d"}
        assert am.hidden_channel_names(db, w["wid"], w["deploy_bot"]) == {"b", "d"}
        assert am.hidden_channel_names(db, w["wid"], w["orphan_bot"]) == {"a", "b"}
        assert am.hidden_channel_names(db, w["wid"], w["machine"]) == set()
        for p in ("mia", "vic", "adam", "gus", "deploy_bot", "orphan_bot"):
            hidden = am.hidden_channel_names(db, w["wid"], w[p])
            for name in "abcd":
                ch = db.execute(select(Channel).where(Channel.name == name, Channel.workspace_id == w["wid"])).scalar_one()
                assert am.can_view_channel(db, w["wid"], w[p], ch) == (name not in hidden), (p, name)


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

class TestAgents:
    def test_default_everyone_grant_and_revocation(self, db, world):
        w = world
        bot = db.execute(select(WorkspaceMember).where(WorkspaceMember.agent_name == "deploy-bot")).scalar_one()
        usable = am.agent_usable_by(db, w["wid"], ["deploy-bot", "orphan-bot"])
        assert usable["deploy-bot"]["everyone"] is True and usable["orphan-bot"]["everyone"] is True
        assert am.legacy_agent_visibility(usable["deploy-bot"]) == "team"
        for p in ("vic", "gus", "adam", "orphan_bot"):
            assert am.can_use_agent(db, w["wid"], w[p], bot), p
        # owner revokes everyone → only the owner (and its own agents) keep it
        for g in am.active_grants(db, w["wid"], "agent", "deploy-bot"):
            am.revoke_grant(db, g, "mia@acme.test")
        db.commit()
        assert am.legacy_agent_visibility(am.agent_usable_by(db, w["wid"], ["deploy-bot"])["deploy-bot"]) == "personal"
        assert am.can_use_agent(db, w["wid"], w["mia"], bot) is True
        assert am.explain(db, w["mia"], am.resource_for_agent(bot), "act").reason == "owner"
        assert am.can_use_agent(db, w["wid"], w["deploy_bot"], bot) is True  # itself
        assert am.can_use_agent(db, w["wid"], w["vic"], bot) is False
        assert am.can_use_agent(db, w["wid"], w["adam"], bot) is False
        assert am.can_use_agent(db, w["wid"], w["machine"], bot) is True
        assert am.hidden_agent_names(db, w["wid"], w["vic"]) == {"deploy-bot"}
        assert am.hidden_agent_names(db, w["wid"], w["mia"]) == set()
        # a direct grant, a group grant, an agent grant
        _grant(db, w["wid"], "agent", "deploy-bot", "human", "vic@acme.test")
        assert am.explain(db, w["vic"], am.resource_for_agent(bot), "act").reason == "grant"
        _grant(db, w["wid"], "agent", "deploy-bot", "agent", "orphan-bot", rights=("act",))
        assert am.can_use_agent(db, w["wid"], w["orphan_bot"], bot) is True
        assert am.agent_usable_by(db, w["wid"], ["deploy-bot"])["deploy-bot"] == {
            "everyone": False, "groups": [], "people": 1, "agents": 1}
        # the agent's owner's agent inherits
        _grant(db, w["wid"], "agent", "orphan-bot", "human", "mia@acme.test")
        orphan = db.execute(select(WorkspaceMember).where(WorkspaceMember.agent_name == "orphan-bot")).scalar_one()
        for g in am.active_grants(db, w["wid"], "agent", "orphan-bot"):
            if g.grantee_kind == "group":
                am.revoke_grant(db, g, "x")
        db.commit()
        assert am.can_use_agent(db, w["wid"], w["deploy_bot"], orphan) is True
        assert am.can_use_agent(db, w["wid"], w["vic"], orphan) is False

    def test_anonymous_human_can_address_everyone_agents(self, db, world):
        """Regression: a token-only client posting as ``human:user`` (no sender
        email) must still be able to @mention team agents — in M1 every team
        agent was visible to such a sender; here that is the `everyone` grant.
        Without it the pipeline silently dropped every human mention."""
        w = world
        assert am.hidden_agent_names(db, w["wid"], w["anon"]) == set()
        bot = db.execute(select(WorkspaceMember).where(WorkspaceMember.agent_name == "deploy-bot")).scalar_one()
        assert am.can_use_agent(db, w["wid"], w["anon"], bot) is True
        assert am.explain(db, w["anon"], am.resource_for_agent(bot), "act").reason == "group:Everyone"
        # revoking everyone hides it from the anonymous sender like anyone else
        for g in am.active_grants(db, w["wid"], "agent", "deploy-bot"):
            am.revoke_grant(db, g, "mia@acme.test")
        db.commit()
        assert am.hidden_agent_names(db, w["wid"], am.Principal("human", workspace_id=w["wid"])) == {"deploy-bot"}
        # a private thread stays private to them unless `everyone` is granted
        ch = _channel(db, w["wid"], "anon-x", owner="mia@acme.test")
        _grant(db, w["wid"], "channel", "anon-x", "group", w["team"].id)
        assert am.can_view_channel(db, w["wid"], am.Principal("human", workspace_id=w["wid"]), ch) is False
        _grant(db, w["wid"], "channel", "anon-x", "group", w["everyone"].id)
        assert am.can_view_channel(db, w["wid"], am.Principal("human", workspace_id=w["wid"]), ch) is True

    def test_agent_owned_resources_belong_to_the_owner_too(self, db, world):
        w = world
        f = _file(db, w["wid"], "bot.txt", owner="openagents:deploy-bot", visibility="private")
        res = am.resource_for_file(f)
        assert _ex(db, w["deploy_bot"], res).reason == "owner"
        assert _ex(db, w["mia"], res).reason == "owner", "a human can always override their agent"
        assert _ex(db, w["vic"], res).allowed is False
        assert am.can_manage(db, w["deploy_bot"], res) is True, "an agent may grant on artifacts it owns"


# ---------------------------------------------------------------------------
# Files & knowledge
# ---------------------------------------------------------------------------

class TestFilesKnowledge:
    def test_files_inherit_from_their_thread(self, db, world):
        w = world
        _channel(db, w["wid"], "secret", owner="mia@acme.test", humans=["mia@acme.test"])
        inherited = am.resource_for_file(_file(db, w["wid"], "in.txt", owner="human:adam@acme.test", visibility=None, channel="secret"))
        assert _ex(db, w["mia"], inherited).reason == "inherited_from_channel"
        assert _ex(db, w["adam"], inherited).reason == "owner"
        assert _ex(db, w["vic"], inherited).allowed is False
        assert _ex(db, w["deploy_bot"], inherited).reason == "inherited_from_owner"
        # explicit visibility beats the thread
        shown = am.resource_for_file(_file(db, w["wid"], "pub.txt", owner="human:adam@acme.test", visibility="public", channel="secret"))
        assert _ex(db, w["vic"], shown).reason == "public"
        # an unattached legacy file with NULL visibility is public (compat)
        legacy = am.resource_for_file(_file(db, w["wid"], "old.txt", owner="human:user", visibility=None))
        assert _ex(db, w["gus"], legacy).reason == "public"
        # bulk filter agrees with the rule
        records = db.execute(select(FileRecord).where(FileRecord.workspace_id == w["wid"])).scalars().all()
        for p in ("mia", "vic", "adam", "gus", "deploy_bot"):
            visible = {r.id for r in am.filter_files(db, w["wid"], w[p], records)}
            expect = {r.id for r in records if am.allowed(db, w[p], am.resource_for_file(r), "read", w["wid"])}
            assert visible == expect, p

    def test_knowledge_rule_and_bulk_filter(self, db, world):
        w = world
        priv = _knowledge(db, w["wid"], "priv", owner="human:mia@acme.test", visibility="private")
        pub = _knowledge(db, w["wid"], "pub", owner="human:mia@acme.test", visibility="public")
        _grant(db, w["wid"], "knowledge", priv.id, "group", w["team"].id, rights=("read",))
        assert _ex(db, w["mia"], am.resource_for_knowledge(priv)).reason == "owner"
        assert _ex(db, w["vic"], am.resource_for_knowledge(priv)).reason == "group:Deploy team"
        assert _ex(db, w["vic"], am.resource_for_knowledge(priv), "act").allowed is False
        assert _ex(db, w["gus"], am.resource_for_knowledge(priv)).allowed is False
        assert _ex(db, w["gus"], am.resource_for_knowledge(pub)).reason == "public"
        assert _ex(db, w["deploy_bot"], am.resource_for_knowledge(priv)).reason == "inherited_from_owner"
        entries = [priv, pub]
        assert {e.slug for e in am.filter_knowledge(db, w["wid"], w["gus"], entries)} == {"pub"}
        assert {e.slug for e in am.filter_knowledge(db, w["wid"], w["vic"], entries)} == {"priv", "pub"}
        assert {e.slug for e in am.filter_knowledge(db, w["wid"], w["machine"], entries)} == {"priv", "pub"}


# ---------------------------------------------------------------------------
# Principals
# ---------------------------------------------------------------------------

class TestPrincipals:
    def test_resolution(self, db, world, monkeypatch):
        import app.access as access
        w = world
        ws = w["ws"]
        monkeypatch.setattr(access, "verify_identity_claims",
                            lambda tok: {"provider": "firebase", "email": "vic@acme.test", "firebase_uid": "v",
                                         "apple_sub": None, "display_name": "Vic"} if tok == "vic" else None)
        # token only → machine
        p = am.resolve_principal(db, ws, ws.password_hash, None)
        assert p.kind == "machine" and p.machine and not p.is_human
        # token + agent identity (header path via the request ContextVar)
        tok = am.set_request_agent_name("deploy-bot")
        try:
            p = am.resolve_principal(db, ws, ws.password_hash, None)
        finally:
            am.reset_request_agent_name(tok)
        assert p.kind == "agent" and p.agent_name == "deploy-bot" and p.owner_email == "mia@acme.test"
        # explicit agent name (body/query source) wins over nothing; unknown agent → machine
        assert am.resolve_principal(db, ws, ws.password_hash, None, agent_name="ghost").kind == "machine"
        assert am.resolve_principal(db, ws, ws.password_hash, None, agent_name="orphan-bot").kind == "agent"
        # a person is a person even with the token and an agent header
        tok = am.set_request_agent_name("deploy-bot")
        try:
            p = am.resolve_principal(db, ws, ws.password_hash, "Bearer vic")
        finally:
            am.reset_request_agent_name(tok)
        assert p.kind == "human" and p.email == "vic@acme.test" and p.role == "viewer"
        # wrong token → anonymous visitor
        p = am.resolve_principal(db, ws, "nope", None)
        assert p.kind == "human" and p.email is None
        # workspace id string works too
        assert am.resolve_principal(db, str(ws.id), ws.password_hash, None).kind == "machine"

    def test_identity_parsing_and_aliases(self):
        assert am.agent_name_from_request({"x-agent-name": "bot-1"}) == "bot-1"
        assert am.agent_name_from_request({}, {"source": "openagents:bot-2"}) == "bot-2"
        assert am.agent_name_from_request({}, {}, {"source": "openagents:bot-3"}) == "bot-3"
        assert am.agent_name_from_request({}, {"source": "human:mia"}) is None
        assert am.agent_name_from_request({"x-agent-name": "  "}) is None
        assert am.normalize_visibility("workspace") == "public"
        assert am.normalize_visibility("PUBLIC") == "public"
        assert am.normalize_visibility("private") == "private"
        assert am.normalize_visibility("bogus") is None
        assert am.normalize_visibility(None, "public") == "public"
        assert am.normalize_rights(["share", "read", "bogus"]) == ["read", "share"]
        assert am.normalize_rights(None) == ["read", "act"]

    def test_group_membership_is_derived_for_builtins(self, db, world):
        w = world
        assert w["everyone"].id in am.principal_group_ids(db, w["wid"], w["gus"])
        assert w["guest_group"].id in am.principal_group_ids(db, w["wid"], w["gus"])
        assert w["guest_group"].id not in am.principal_group_ids(db, w["wid"], w["vic"])
        assert w["team"].id in am.principal_group_ids(db, w["wid"], w["vic"])
        assert w["everyone"].id in am.principal_group_ids(db, w["wid"], w["orphan_bot"]), "agents are in everyone"
        assert am.principal_group_ids(db, w["wid"], w["machine"]) == set()
        # an anonymous human the workspace let in is "everyone", nothing more
        assert am.principal_group_ids(db, w["wid"], w["anon"]) == {w["everyone"].id}
        members = am.group_members(db, w["ws"], w["everyone"])
        kinds = {(m["principal_kind"], m["principal_id"]) for m in members}
        assert ("human", "gus@acme.test") in kinds and ("agent", "deploy-bot") in kinds
        assert [m["principal_id"] for m in am.group_members(db, w["ws"], w["guest_group"])] == ["gus@acme.test"]
        assert [m["principal_id"] for m in am.group_members(db, w["ws"], w["team"])] == ["vic@acme.test"]
