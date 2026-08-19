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
        channel_name = data["channel"]["name"]
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
