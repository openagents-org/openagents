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
