# -*- coding: utf-8 -*-
"""
Tests for the built-in Yumi onboarding assistant.

Covers:
- Provisioning is gated on YUMI_ENABLED + YUMI_API_KEY (self-hosted without a
  key gets no Yumi, so it doesn't break the existing suite).
- New workspaces auto-provision Yumi, which surfaces with builtin=true in both
  /v1/discover and /v1/workspaces/{id}; real agents stay builtin=false.
- Yumi can be re-added keylessly via POST /v1/cloud-agents (provider
  "openagents") after removal, with category "assistant".
- The assistant tool loop posts a chat reply (LLM stubbed).
"""

import asyncio

import pytest
from sqlalchemy import select

from app.config import config
from app.models import CloudAgentConfig, EventRecord, WorkspaceMember


@pytest.fixture
def yumi_enabled(monkeypatch):
    """Enable Yumi with a fake server-held key for the duration of a test."""
    monkeypatch.setattr(config, "YUMI_ENABLED", True)
    monkeypatch.setattr(config, "YUMI_API_KEY", "test-server-key")
    monkeypatch.setattr(config, "YUMI_MODEL", "deepseek-v4-pro")
    return True


def _create_workspace(client, name="Yumi WS"):
    resp = client.post("/v1/workspaces", json={
        "name": name,
        "agent_name": "agent-alpha",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    return resp.json()["data"]


def _discover(client, ws_id, token):
    resp = client.get("/v1/discover", params={"network": ws_id},
                      headers={"X-Workspace-Token": token})
    assert resp.status_code == 200
    return resp.json()["data"]["agents"]


class TestProvisioning:
    def test_not_provisioned_without_key(self, client):
        """Default env (no YUMI_API_KEY) → no Yumi, existing behavior intact."""
        data = _create_workspace(client)
        addresses = [a["address"] for a in _discover(client, data["workspaceId"], data["token"])]
        assert "openagents:yumi" not in addresses

    def test_provisioned_with_key(self, client, yumi_enabled):
        data = _create_workspace(client)
        agents = _discover(client, data["workspaceId"], data["token"])
        by_addr = {a["address"]: a for a in agents}

        assert "openagents:yumi" in by_addr, "Yumi should be auto-added"
        yumi = by_addr["openagents:yumi"]
        assert yumi["builtin"] is True
        assert yumi["agent_type"] == "cloud:openagents"
        # A real agent must NOT be flagged builtin.
        assert by_addr["openagents:agent-alpha"]["builtin"] is False

    def test_builtin_flag_in_workspace_detail(self, client, yumi_enabled):
        data = _create_workspace(client)
        resp = client.get(f"/v1/workspaces/{data['workspaceId']}",
                          headers={"X-Workspace-Token": data["token"]})
        assert resp.status_code == 200
        agents = {a["agentName"]: a for a in resp.json()["data"]["agents"]}
        assert agents["yumi"]["builtin"] is True
        assert agents["agent-alpha"]["builtin"] is False

    def test_provisioning_is_idempotent(self, client, yumi_enabled, db):
        """provision_yumi twice must not create duplicate rows."""
        from app.models import Workspace
        from app.services.yumi import provision_yumi

        data = _create_workspace(client)
        ws = db.execute(select(Workspace).where(Workspace.id == data["workspaceId"])).scalar_one()
        added = provision_yumi(db, ws)
        assert added is False  # already there from creation
        members = db.execute(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.agent_name == "yumi",
        )).scalars().all()
        assert len(members) == 1


class TestKeylessReadd:
    def test_readd_yumi_without_key(self, client, yumi_enabled):
        data = _create_workspace(client)
        ws_id, token = data["workspaceId"], data["token"]

        # Remove the built-in agent (hard delete, as the UI does).
        resp = client.request(
            "DELETE", f"/v1/cloud-agents/yumi",
            params={"network": ws_id}, headers={"X-Workspace-Token": token},
        )
        assert resp.status_code == 200
        assert "openagents:yumi" not in [a["address"] for a in _discover(client, ws_id, token)]

        # Re-add via the Connect view path: provider "openagents", NO api key.
        resp = client.post("/v1/cloud-agents", json={
            "network": ws_id,
            "agent_name": "yumi",
            "provider": "openagents",
            "model": "deepseek-v4-pro",
            "api_key": "",
        }, headers={"X-Workspace-Token": token})
        assert resp.status_code == 200, resp.text
        body = resp.json()["data"]
        assert body["category"] == "assistant"

        agents = {a["address"]: a for a in _discover(client, ws_id, token)}
        assert agents["openagents:yumi"]["builtin"] is True


class TestServerResolvedModel:
    def test_builtin_model_comes_from_config_not_row(self, client, yumi_enabled, db, monkeypatch):
        """Existing workspaces' Yumi rows keep old model ids; the runtime model
        must come from config so a server-side switch needs no backfill."""
        from sqlalchemy import select
        from app.services.yumi import resolve_model

        data = _create_workspace(client)
        cfg = db.execute(select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == data["workspaceId"],
            CloudAgentConfig.agent_name == "yumi",
        )).scalar_one()

        cfg.model = "deepseek-v4-pro"  # stale persisted value
        monkeypatch.setattr(config, "YUMI_MODEL", "deepseek-4-flash")
        assert resolve_model(cfg) == "deepseek-4-flash"

        # Non-builtin agents keep their per-row model.
        cfg.provider = "deepseek"
        assert resolve_model(cfg) == "deepseek-v4-pro"


class TestYumiTools:
    """Yumi tools must go through the real HTTP API (in-process ASGI), never
    direct DB queries — pairing codes, nodes, remote commands, threads."""

    def _api(self, data):
        from app.services.yumi import WorkspaceApi
        return WorkspaceApi(data["workspaceId"], data["token"])

    def test_pairing_redeem_nodes_and_commands(self, client, yumi_enabled):
        from app.services.yumi import execute_tool

        data = _create_workspace(client)
        api = self._api(data)

        # 1. Mint a pairing code.
        pairing = asyncio.run(execute_tool(api, "yumi", "create_pairing_code", {}))
        assert pairing["ok"], pairing
        assert "-" in pairing["code"] and len(pairing["code"]) == 9

        # 2. A device redeems it (no auth — the code is the credential).
        resp = client.post("/v1/nodes/redeem", json={
            "code": pairing["code"],
            "node_key": "device-abc",
            "hostname": "test-laptop",
            "os": "macOS",
        })
        assert resp.status_code == 200, resp.text
        node_id = resp.json()["data"]["nodeId"]

        # 3. The node shows up for Yumi.
        nodes = asyncio.run(execute_tool(api, "yumi", "list_nodes", {}))
        assert nodes["ok"] and len(nodes["nodes"]) == 1
        assert nodes["nodes"][0]["node_id"] == node_id
        assert nodes["nodes"][0]["hostname"] == "test-laptop"

        # 4. Queue a remote create_agent command on that node.
        queued = asyncio.run(execute_tool(api, "yumi", "manage_node_agent", {
            "node_id": node_id, "action": "create_agent",
            "agent_name": "my-claude", "agent_type": "claude",
        }))
        assert queued["ok"], queued
        assert queued["status"] == "pending"

        # 5. The command is visible for debugging.
        cmds = asyncio.run(execute_tool(api, "yumi", "get_node_commands",
                                        {"node_id": node_id}))
        assert cmds["ok"] and cmds["commands"][0]["action"] == "create_agent"

    def test_remove_agent_action_is_blocked(self, client, yumi_enabled):
        from app.services.yumi import execute_tool

        data = _create_workspace(client)
        res = asyncio.run(execute_tool(self._api(data), "yumi", "manage_node_agent", {
            "node_id": "whatever", "action": "remove_agent", "agent_name": "x",
        }))
        assert res["ok"] is False and "not allowed" in res["error"]

    def test_create_thread_and_reads_via_api(self, client, yumi_enabled):
        from app.services.yumi import execute_tool

        data = _create_workspace(client)
        api = self._api(data)

        created = asyncio.run(execute_tool(api, "yumi", "create_thread",
                                           {"title": "Planning"}))
        assert created["ok"] and created["channel_name"]

        threads = asyncio.run(execute_tool(api, "yumi", "list_threads", {}))
        assert threads["ok"]
        assert any(t["title"] == "Planning" for t in threads["threads"])

        agents = asyncio.run(execute_tool(api, "yumi", "list_agents", {}))
        assert agents["ok"]
        yumi_row = next(a for a in agents["agents"] if a["name"] == "yumi")
        assert yumi_row["builtin"] is True

        catalog = asyncio.run(execute_tool(api, "yumi", "get_agent_catalog", {}))
        assert catalog["ok"] and len(catalog["agent_types"]) > 0

    def test_create_and_list_tasks(self, client, yumi_enabled):
        from app.services.yumi import execute_tool

        data = _create_workspace(client)
        api = self._api(data)

        created = asyncio.run(execute_tool(api, "yumi", "create_task", {
            "title": "Write onboarding docs", "priority": "high",
            "assignee": "agent-alpha",
        }))
        assert created["ok"], created
        assert created["status"] == "backlog"

        # Visible on the real Tasks board endpoint...
        resp = client.get("/v1/tasks", params={"network": data["workspaceId"]},
                          headers={"X-Workspace-Token": data["token"]})
        board = resp.json()["data"]["tasks"]
        assert any(t["title"] == "Write onboarding docs" and t["priority"] == "high"
                   for t in board)

        # ...and via Yumi's read tool.
        listed = asyncio.run(execute_tool(api, "yumi", "list_tasks", {}))
        assert listed["ok"]
        assert any(t["title"] == "Write onboarding docs" for t in listed["tasks"])

    def test_state_summary_mentions_nodes(self, client, yumi_enabled):
        from app.services.yumi import workspace_state_summary

        data = _create_workspace(client)
        summary = asyncio.run(workspace_state_summary(self._api(data)))
        assert "agent-alpha" in summary
        assert "nodes" in summary.lower()


class TestAssistantLoop:
    def test_assistant_posts_chat(self, client, yumi_enabled, db, monkeypatch):
        """The assistant tool loop posts a chat reply (LLM stubbed, no tools)."""
        from app.models import Workspace
        from app.services import cloud_agent

        data = _create_workspace(client)
        ws_id = data["workspaceId"]
        # Yumi only speaks in threads it was added to — use one of its own.
        channel_name = _make_thread(client, data, "Chat", ["yumi"], master="yumi")
        channel_target = f"channel/{channel_name}"

        async def fake_chat_completion_tools(**kwargs):
            return {"role": "assistant", "content": "Hi! I'm Yumi, welcome aboard."}

        monkeypatch.setattr(cloud_agent, "chat_completion_tools", fake_chat_completion_tools)

        cfg = db.execute(select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == ws_id,
            CloudAgentConfig.agent_name == "yumi",
        )).scalar_one()

        event_data = {
            "target": channel_target,
            "payload": {"content": "hello", "message_type": "chat"},
            "metadata": {"target_agents": ["yumi"]},
        }

        asyncio.run(cloud_agent._invoke_assistant_agent(db, ws_id, event_data, cfg, 0))

        posts = db.execute(select(EventRecord).where(
            EventRecord.network_id == ws_id,
            EventRecord.source == "openagents:yumi",
            EventRecord.type == "workspace.message.posted",
        )).scalars().all()
        assert any((p.payload or {}).get("content", "").startswith("Hi! I'm Yumi") for p in posts)


class TestNamespaceGuard:
    def test_clash_skips_and_leaves_session_clean(self, client, db, monkeypatch):
        """A member displaying as "Yumi" blocks the backfill — and the bail-out
        must not leave a pending CloudAgentConfig in the shared session, or the
        next workspace's commit would persist it (P1, review round 3)."""
        # Create the workspace with Yumi disabled so nothing is provisioned yet.
        data = _create_workspace(client)
        resp = client.patch(
            f"/v1/workspaces/{data['workspaceId']}/members/agent-alpha",
            json={"display_name": "Yumi"},
            headers={"X-Workspace-Token": data["token"]},
        )
        assert resp.status_code == 200

        monkeypatch.setattr(config, "YUMI_ENABLED", True)
        monkeypatch.setattr(config, "YUMI_API_KEY", "test-server-key")

        from app.models import Workspace
        from app.services.yumi import provision_yumi
        ws = db.execute(
            select(Workspace).where(Workspace.id == data["workspaceId"])
        ).scalar_one()

        assert provision_yumi(db, ws) is False
        assert len(db.new) == 0, f"pending orphans: {db.new}"

        # A later commit (e.g. for the next workspace in the backfill loop)
        # must not persist anything for this workspace.
        db.commit()
        cfgs = db.execute(
            select(CloudAgentConfig).where(
                CloudAgentConfig.workspace_id == data["workspaceId"],
            )
        ).scalars().all()
        assert cfgs == []

    def test_backfill_does_not_take_over_real_yumi_agent(self, client, db, monkeypatch):
        """A user's daemon agent that happens to be named "yumi" keeps its
        type/description — backfill must skip, not take over (review round 4)."""
        data = _create_workspace(client)
        resp = client.post("/v1/join", json={
            "agent_name": "yumi",
            "agent_type": "claude",
            "token": data["token"],
            "network": data["workspaceId"],
        })
        assert resp.status_code == 200

        monkeypatch.setattr(config, "YUMI_ENABLED", True)
        monkeypatch.setattr(config, "YUMI_API_KEY", "test-server-key")

        from app.models import Workspace
        from app.services.yumi import provision_yumi
        ws = db.execute(
            select(Workspace).where(Workspace.id == data["workspaceId"])
        ).scalar_one()

        assert provision_yumi(db, ws) is False
        assert len(db.new) == 0
        db.expire_all()
        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == data["workspaceId"],
                WorkspaceMember.agent_name == "yumi",
            )
        ).scalar_one()
        assert member.agent_type == "claude"

    def test_backfill_does_not_resurrect_removed_real_agent(self, client, db, monkeypatch):
        """A soft-removed real agent named "yumi" must stay removed/claude —
        backfill must not rewrite it to online/cloud:openagents (round 5)."""
        data = _create_workspace(client)
        client.post("/v1/join", json={
            "agent_name": "yumi",
            "agent_type": "claude",
            "token": data["token"],
            "network": data["workspaceId"],
        })
        removed = client.post("/v1/remove", json={
            "agent_name": "yumi",
            "network": data["workspaceId"],
        }, headers={"X-Workspace-Token": data["token"]})
        assert removed.status_code == 200

        monkeypatch.setattr(config, "YUMI_ENABLED", True)
        monkeypatch.setattr(config, "YUMI_API_KEY", "test-server-key")

        from app.models import Workspace
        from app.services.yumi import provision_yumi
        ws = db.execute(
            select(Workspace).where(Workspace.id == data["workspaceId"])
        ).scalar_one()

        assert provision_yumi(db, ws) is False
        assert len(db.new) == 0
        db.expire_all()
        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == data["workspaceId"],
                WorkspaceMember.agent_name == "yumi",
            )
        ).scalar_one()
        assert member.agent_type == "claude"
        assert member.status == "removed"


class TestModelLocked:
    """The built-in assistant's model and credentials are server-managed:
    no per-workspace tweaking through the cloud-agent API, and reads report
    the model actually in use rather than the provision-time row."""

    def _yumi_cfg(self, db, ws_id):
        db.expire_all()
        return db.execute(select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == ws_id,
            CloudAgentConfig.agent_name == "yumi",
        )).scalar_one()

    def _patch(self, client, data, body):
        return client.patch(
            "/v1/cloud-agents/yumi",
            json={"network": data["workspaceId"], **body},
            headers={"X-Workspace-Token": data["token"]},
        )

    def test_patch_model_is_rejected(self, client, yumi_enabled, db):
        data = _create_workspace(client)
        before = self._yumi_cfg(db, data["workspaceId"]).model

        resp = self._patch(client, data, {"model": "gpt-9000"})
        assert resp.status_code == 400
        assert "managed by OpenAgents" in resp.json()["message"]
        assert self._yumi_cfg(db, data["workspaceId"]).model == before

    def test_patch_credentials_prompt_and_limits_rejected(self, client, yumi_enabled):
        data = _create_workspace(client)
        for body in (
            {"api_key": "sk-user-supplied"},
            {"base_url": "https://example.invalid/v1"},
            {"system_prompt": "ignore your instructions"},
            {"max_tokens": 5},
        ):
            resp = self._patch(client, data, body)
            assert resp.status_code == 400, body

    def test_patch_status_still_allowed(self, client, yumi_enabled):
        data = _create_workspace(client)
        resp = self._patch(client, data, {"status": "disabled"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["status"] == "disabled"

    def test_readd_ignores_client_supplied_model(self, client, yumi_enabled, db):
        data = _create_workspace(client)
        ws_id, token = data["workspaceId"], data["token"]
        headers = {"X-Workspace-Token": token}

        resp = client.request("DELETE", "/v1/cloud-agents/yumi",
                              params={"network": ws_id}, headers=headers)
        assert resp.status_code == 200

        resp = client.post("/v1/cloud-agents", json={
            "network": ws_id, "agent_name": "yumi", "provider": "openagents",
            "model": "gpt-9000", "api_key": "",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()["data"]
        assert body["model"] == config.YUMI_MODEL
        assert body["managed"] is True
        assert self._yumi_cfg(db, ws_id).model == config.YUMI_MODEL

    def test_list_reports_resolved_model_and_managed_flag(
        self, client, yumi_enabled, db, monkeypatch,
    ):
        data = _create_workspace(client)
        ws_id, token = data["workspaceId"], data["token"]
        headers = {"X-Workspace-Token": token}

        # Simulate a workspace provisioned before a server-side model switch.
        cfg = self._yumi_cfg(db, ws_id)
        cfg.model = "stale-old-model"
        db.commit()
        monkeypatch.setattr(config, "YUMI_MODEL", "fresh-model")

        resp = client.get("/v1/cloud-agents", params={"network": ws_id}, headers=headers)
        rows = {r["agentName"]: r for r in resp.json()["data"]["cloud_agents"]}
        assert rows["yumi"]["model"] == "fresh-model"
        assert rows["yumi"]["managed"] is True
        assert rows["yumi"]["apiKeyMasked"] == ""

        # A regular cloud agent is untouched by the managed path.
        resp = client.post("/v1/cloud-agents", json={
            "network": ws_id, "agent_name": "plain-bot", "provider": "openai",
            "model": "gpt-5.6-sol", "api_key": "sk-plain-1234567890",
        }, headers=headers)
        assert resp.status_code == 200, resp.text
        resp = client.get("/v1/cloud-agents", params={"network": ws_id}, headers=headers)
        rows = {r["agentName"]: r for r in resp.json()["data"]["cloud_agents"]}
        assert rows["plain-bot"]["managed"] is False
        assert rows["plain-bot"]["model"] == "gpt-5.6-sol"


# ---------------------------------------------------------------------------
# Manager / coordination behaviour
# ---------------------------------------------------------------------------

def _hdr(data):
    return {"X-Workspace-Token": data["token"]}


def _make_thread(client, data, title, participants, master=None):
    payload = {"title": title, "participants": participants}
    if master:
        payload["master"] = master
    r = client.post("/v1/events", json={
        "type": "network.channel.create", "source": "human:raphael", "target": "core",
        "payload": payload, "metadata": {}, "network": data["workspaceId"],
    }, headers=_hdr(data))
    assert r.status_code == 200, r.text
    return r.json()["data"]["metadata"]["channel_name"]


def _post(client, data, ch, source, content, metadata=None, **payload_extra):
    payload = {"content": content, "message_type": "chat", **payload_extra}
    r = client.post("/v1/events", json={
        "type": "workspace.message.posted", "source": source, "target": f"channel/{ch}",
        "payload": payload, "metadata": metadata or {}, "network": data["workspaceId"],
    }, headers=_hdr(data))
    assert r.status_code == 200, r.text
    return (r.json()["data"].get("metadata") or {}).get("target_agents")


def _join(client, data, name, agent_type="claude"):
    r = client.post("/v1/join", json={
        "agent_name": name, "token": data["token"], "network": data["workspaceId"],
        "agent_type": agent_type,
    })
    assert r.status_code == 200, r.text


def _channel(client, data, ch):
    r = client.get(f"/v1/workspaces/{data['workspaceId']}/channels/{ch}", headers=_hdr(data))
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _events(client, data, ch, limit=5):
    r = client.get(
        f"/v1/events?network={data['workspaceId']}&channel={ch}"
        f"&type=workspace.message.posted&sort=desc&limit={limit}", headers=_hdr(data),
    )
    d = r.json()["data"]
    return d if isinstance(d, list) else d.get("events", [])


@pytest.fixture
def quiet_background(monkeypatch):
    """POST /v1/events schedules background work after the response (push
    fan-out, cloud-agent invocation, workflow/relay/campaign hooks) that opens
    its own DB session against the configured DATABASE_URL — not available in
    unit tests. Stub them so posting a message exercises routing only."""
    import app.services.campaign as campaign
    import app.services.cloud_agent as cloud_agent
    import app.services.integrations as integrations
    import app.services.push as push
    import app.services.workflow as workflow

    def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(push, "fanout_for_event", noop)
    monkeypatch.setattr(cloud_agent, "invoke_cloud_agents", noop)
    monkeypatch.setattr(workflow, "advance_workflow", noop)
    monkeypatch.setattr(integrations, "relay_for_event", noop)
    monkeypatch.setattr(campaign, "on_agent_message", noop)


class TestSpeakerAttribution:
    def test_context_labels_other_speakers(self, client, yumi_enabled, db, quiet_background):
        import time
        from app.services.cloud_agent import _build_conversation_context

        data = _create_workspace(client)
        ws, ch = data["workspaceId"], data["channel"]["name"]
        _post(client, data, ch, "human:raphael", "hello team",
              sender_display_name="Raphael", sender_email="raphael@example.com")
        _post(client, data, ch, "openagents:agent-alpha", "on it")
        horizon = int(time.time() * 1000) + 5000

        plain = _build_conversation_context(db, ws, f"channel/{ch}", "yumi", before_timestamp=horizon)
        labelled = _build_conversation_context(
            db, ws, f"channel/{ch}", "yumi", before_timestamp=horizon, attribute_speakers=True,
        )
        assert [m["content"] for m in plain] == ["hello team", "on it"]
        assert [m["content"] for m in labelled] == ["[Raphael] hello team", "[agent-alpha] on it"]


class TestDelegationRouting:
    def test_explicit_targets_are_honored_and_invite(self, client, yumi_enabled, quiet_background):
        data = _create_workspace(client)
        ch = _make_thread(client, data, "Coord", ["yumi", "agent-alpha"], master="agent-alpha")

        # A declared hand-off reaches exactly that agent.
        assert _post(client, data, ch, "openagents:yumi", "@agent-alpha please fix it",
                     {"explicit_targets": ["agent-alpha"]}) == ["agent-alpha"]
        # Declared "nobody" wakes nobody — even though the fallback would
        # have routed this agent message to the leader.
        assert _post(client, data, ch, "openagents:yumi", "talking about agent-alpha",
                     {"explicit_targets": []}) == ["__no_response__"]
        # A hand-off to a non-participant is delivered AND invites it.
        _join(client, data, "agent-beta")
        assert _post(client, data, ch, "openagents:yumi", "@agent-beta take over",
                     {"explicit_targets": ["agent-beta"]}) == ["agent-beta"]
        assert "agent-beta" in _channel(client, data, ch)["participants"]

    def test_leading_mention_from_agent_is_honored(self, client, yumi_enabled, quiet_background):
        data = _create_workspace(client)
        ch = _make_thread(client, data, "Coord", ["yumi", "agent-alpha"], master="agent-alpha")
        assert _post(client, data, ch, "openagents:agent-alpha", "@yumi done — fixed in PR #42") == ["yumi"]


class TestManagerTools:
    def test_add_agent_set_leader_read_post(self, client, yumi_enabled, quiet_background):
        from app.services.yumi import WorkspaceApi, execute_tool

        data = _create_workspace(client)
        api = WorkspaceApi(data["workspaceId"], data["token"])
        # Yumi is deliberately NOT the leader: the built-in may still manage membership.
        ch = _make_thread(client, data, "Plan", ["yumi", "agent-alpha"], master="agent-alpha")
        _join(client, data, "agent-beta")

        res = asyncio.run(execute_tool(api, "yumi", "add_agent_to_thread",
                                       {"agent_name": "agent-beta"}, channel_name=ch))
        assert res["ok"], res
        assert "agent-beta" in _channel(client, data, ch)["participants"]

        res = asyncio.run(execute_tool(api, "yumi", "add_agent_to_thread",
                                       {"agent_name": "nobody-here"}, channel_name=ch))
        assert res["ok"] is False

        res = asyncio.run(execute_tool(api, "yumi", "set_thread_leader",
                                       {"agent_name": "agent-beta"}, channel_name=ch))
        assert res["ok"], res
        assert _channel(client, data, ch)["masterAgent"] == "agent-beta"

        ch2 = _make_thread(client, data, "Research", ["yumi", "agent-alpha"], master="agent-alpha")
        res = asyncio.run(execute_tool(api, "yumi", "post_to_thread",
                                       {"thread": ch2, "message": "@agent-alpha please review the plan"},
                                       channel_name=ch, allow_delegation=True))
        assert res["ok"] and res["delivered_to"] == ["agent-alpha"], res
        newest = _events(client, data, ch2)[0]
        assert newest["source"] == "openagents:yumi"
        assert (newest.get("metadata") or {}).get("target_agents") == ["agent-alpha"]

        blocked = asyncio.run(execute_tool(api, "yumi", "post_to_thread",
                                           {"thread": ch2, "message": "@agent-alpha again"},
                                           channel_name=ch, allow_delegation=False))
        assert blocked["ok"] is False

        res = asyncio.run(execute_tool(api, "yumi", "read_thread", {"thread": ch2}))
        assert res["ok"], res
        assert res["messages"][-1]["speaker"] == "yumi"
        assert "please review the plan" in res["messages"][-1]["text"]

        res = asyncio.run(execute_tool(api, "yumi", "list_threads", {}))
        row = next(t for t in res["threads"] if t["thread_id"] == ch)
        assert row["leader"] == "agent-beta" and "agent-beta" in row["agents"]


class TestAssistantDelegation:
    def _run(self, client, data, db, monkeypatch, ch, source, text, reply):
        from app.services import cloud_agent

        async def fake(**kwargs):
            return {"role": "assistant", "content": reply}

        monkeypatch.setattr(cloud_agent, "chat_completion_tools", fake)
        cfg = db.execute(select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == data["workspaceId"],
            CloudAgentConfig.agent_name == "yumi",
        )).scalar_one()
        event_data = {
            "source": source, "target": f"channel/{ch}",
            "payload": {"content": text, "message_type": "chat", "sender_display_name": "Raphael"},
            "metadata": {"target_agents": ["yumi"]},
        }
        asyncio.run(cloud_agent._invoke_assistant_agent(db, data["workspaceId"], event_data, cfg, 0))
        e = next(x for x in _events(client, data, ch) if x["source"] == "openagents:yumi")
        return (e.get("metadata") or {}).get("target_agents")

    def test_human_triggered_mention_delivers(self, client, yumi_enabled, db, monkeypatch):
        data = _create_workspace(client)
        ch = _make_thread(client, data, "Coord", ["yumi", "agent-alpha"], master="yumi")
        assert self._run(client, data, db, monkeypatch, ch, "human:raphael", "ask alpha to fix it",
                         "Handing this to @agent-alpha — please fix the login bug.") == ["agent-alpha"]

    def test_agent_triggered_reply_never_redelegates(self, client, yumi_enabled, db, monkeypatch):
        data = _create_workspace(client)
        ch = _make_thread(client, data, "Coord", ["yumi", "agent-alpha"], master="yumi")
        assert self._run(client, data, db, monkeypatch, ch, "openagents:agent-alpha", "@yumi done",
                         "Thanks! @agent-alpha now also do the tests.") == ["__no_response__"]

    def test_plain_reply_wakes_nobody(self, client, yumi_enabled, db, monkeypatch):
        data = _create_workspace(client)
        ch = _make_thread(client, data, "Coord", ["yumi", "agent-alpha"], master="agent-alpha")
        assert self._run(client, data, db, monkeypatch, ch, "human:raphael", "who is here?",
                         "agent-alpha is here and online.") == ["__no_response__"]


class TestBuiltinPresence:
    """Yumi is only in the threads a human added it to. Agents can't pull it
    into a thread by addressing it, and it stays silent where it isn't in."""

    def test_agent_addressing_does_not_pull_yumi_in(self, client, yumi_enabled, quiet_background):
        data = _create_workspace(client)
        _join(client, data, "agent-beta")
        ch = _make_thread(client, data, "No Yumi here", ["agent-alpha", "agent-beta"],
                          master="agent-alpha")

        # A leading @mention from an agent wakes nobody and adds nobody...
        assert _post(client, data, ch, "openagents:agent-alpha",
                     "@yumi done with the fix") == ["__no_response__"]
        # ...and so does a declared hand-off naming the built-in.
        assert _post(client, data, ch, "openagents:agent-alpha", "hand off",
                     {"explicit_targets": ["yumi"]}) == ["__no_response__"]
        assert "yumi" not in _channel(client, data, ch)["participants"]

        # Not even a human @mention pulls it in: the message follows the
        # thread's normal routing, Yumi isn't added, and a system notice tells
        # the human where Yumi lives.
        tg = _post(client, data, ch, "human:raphael", "@yumi can you help?")
        assert "yumi" not in (tg or [])
        assert "yumi" not in _channel(client, data, ch)["participants"]
        notices = [
            e for e in _events(client, data, ch, limit=6)
            if e.get("source") == "system:workspace"
            and (e.get("metadata") or {}).get("system_notice") == "builtin_not_in_thread"
        ]
        assert notices, "expected a 'not in this thread' notice"

    def test_yumi_stays_silent_where_not_a_participant(self, client, yumi_enabled, db, monkeypatch):
        from app.services import cloud_agent

        data = _create_workspace(client)
        ch = _make_thread(client, data, "Private", ["agent-alpha"], master="agent-alpha")
        called = []

        async def fake(**kwargs):
            called.append(1)
            return {"role": "assistant", "content": "hi"}

        monkeypatch.setattr(cloud_agent, "chat_completion_tools", fake)
        cfg = db.execute(select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == data["workspaceId"],
            CloudAgentConfig.agent_name == "yumi",
        )).scalar_one()
        event_data = {
            "source": "human:raphael", "target": f"channel/{ch}",
            "payload": {"content": "hi", "message_type": "chat"},
            "metadata": {"target_agents": ["yumi"]},
        }
        asyncio.run(cloud_agent._invoke_assistant_agent(db, data["workspaceId"], event_data, cfg, 0))
        assert called == []
        assert not [e for e in _events(client, data, ch) if e["source"] == "openagents:yumi"]
