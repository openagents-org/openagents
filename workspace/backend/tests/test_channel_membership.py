# -*- coding: utf-8 -*-
"""
Tests for channel.join / channel.leave authorization + routine-channel lock.
"""


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _post_event(client, workspace, *, etype, source, channel, agent_name):
    return client.post(
        "/v1/events",
        json={
            "type": etype,
            "source": source,
            "target": f"channel/{channel}",
            "network": workspace["id"],
            "payload": {"channel": channel, "agent_name": agent_name},
        },
        headers=_headers(workspace),
    )


class TestChannelJoinAuth:
    def test_workspace_create_emits_initial_agent_bootstrap_event(self, client):
        resp = client.post("/v1/workspaces", json={
            "name": "Bootstrap Workspace",
            "agent_name": "agent-initial",
            "agent_type": "cursor",
        })
        assert resp.status_code == 200, resp.text
        workspace = resp.json()["data"]
        channel = workspace["channel"]["name"]

        events_resp = client.get(
            "/v1/events",
            params={
                "network": workspace["workspaceId"],
                "type": "workspace.agent.bootstrap",
                "limit": 20,
            },
            headers=_headers({"token": workspace["token"]}),
        )
        assert events_resp.status_code == 200, events_resp.text
        events = events_resp.json()["data"]["events"]
        bootstraps = [
            e for e in events
            if e["type"] == "workspace.agent.bootstrap"
            and e["target"] == "openagents:agent-initial"
        ]
        assert bootstraps
        bootstrap = bootstraps[0]
        assert bootstrap["payload"]["channel"] == channel
        assert bootstrap["metadata"]["target_agents"] == ["agent-initial"]

    def test_human_can_invite(self, client, workspace):
        channel = workspace["channel"]["name"]
        resp = _post_event(
            client, workspace,
            etype="network.channel.join",
            source="human:user",
            channel=channel,
            agent_name="agent-alpha",
        )
        assert resp.status_code == 200, resp.text

    def test_join_emits_agent_bootstrap_event(self, client, workspace):
        channel = workspace["channel"]["name"]
        resp = _post_event(
            client, workspace,
            etype="network.channel.join",
            source="human:user",
            channel=channel,
            agent_name="agent-bootstrap",
        )
        assert resp.status_code == 200, resp.text

        events_resp = client.get(
            "/v1/events",
            params={
                "network": workspace["id"],
                "type": "workspace.agent.bootstrap",
                "limit": 20,
            },
            headers=_headers(workspace),
        )
        assert events_resp.status_code == 200, events_resp.text
        events = events_resp.json()["data"]["events"]
        bootstraps = [
            e for e in events
            if e["type"] == "workspace.agent.bootstrap"
            and e["target"] == "openagents:agent-bootstrap"
        ]
        assert bootstraps
        bootstrap = bootstraps[0]
        assert bootstrap["payload"]["channel"] == channel
        assert bootstrap["metadata"]["target_agents"] == ["agent-bootstrap"]

    def test_unrelated_agent_cannot_invite(self, client, workspace):
        """Random openagents source can't add an agent to a channel they don't own."""
        channel = workspace["channel"]["name"]
        resp = _post_event(
            client, workspace,
            etype="network.channel.join",
            source="openagents:random-bystander",
            channel=channel,
            agent_name="agent-alpha",
        )
        assert resp.status_code == 403, resp.text
        assert "forbidden" in resp.json()["message"].lower()

    def test_agent_can_join_self(self, client, workspace):
        """An agent can join a channel as itself (the agent_name in payload)."""
        channel = workspace["channel"]["name"]
        resp = _post_event(
            client, workspace,
            etype="network.channel.join",
            source="openagents:agent-beta",
            channel=channel,
            agent_name="agent-beta",
        )
        assert resp.status_code == 200, resp.text

    def test_join_routine_channel_rejected(self, client, workspace):
        """routines:* channels are locked — even humans can't add agents."""
        resp = _post_event(
            client, workspace,
            etype="network.channel.join",
            source="human:user",
            channel="routines:agent-alpha",
            agent_name="some-other-agent",
        )
        assert resp.status_code == 403, resp.text
        assert "routine_channel_locked" in resp.json()["message"]


class TestChannelLeaveAuth:
    def test_human_can_remove(self, client, workspace):
        channel = workspace["channel"]["name"]
        resp = _post_event(
            client, workspace,
            etype="network.channel.leave",
            source="human:user",
            channel=channel,
            agent_name="agent-alpha",
        )
        assert resp.status_code == 200, resp.text

    def test_unrelated_agent_cannot_remove(self, client, workspace):
        channel = workspace["channel"]["name"]
        resp = _post_event(
            client, workspace,
            etype="network.channel.leave",
            source="openagents:random-bystander",
            channel=channel,
            agent_name="agent-alpha",
        )
        assert resp.status_code == 403, resp.text

    def test_agent_can_remove_self(self, client, workspace):
        channel = workspace["channel"]["name"]
        resp = _post_event(
            client, workspace,
            etype="network.channel.leave",
            source="openagents:agent-alpha",
            channel=channel,
            agent_name="agent-alpha",
        )
        assert resp.status_code == 200, resp.text

    def test_leave_routine_channel_rejected(self, client, workspace):
        resp = _post_event(
            client, workspace,
            etype="network.channel.leave",
            source="human:user",
            channel="routines:agent-alpha",
            agent_name="agent-alpha",
        )
        assert resp.status_code == 403, resp.text
        assert "routine_channel_locked" in resp.json()["message"]
