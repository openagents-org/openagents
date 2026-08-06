# -*- coding: utf-8 -*-
"""Per-agent busy state: which agent is running a turn, in which channel.

Before this existed the UI guessed from whether a channel's last message
happened to be a status message, which collapses a multi-agent thread into a
single flag. The agents now report it themselves — a `workspace.agent.state`
event on every turn start/end, plus the full busy set on every heartbeat.
"""


def _join(client, workspace, agent_name):
    return client.post("/v1/join", json={
        "agent_name": agent_name,
        "token": workspace["token"],
        "network": workspace["id"],
    })


def _agent_row(client, workspace, agent_name):
    resp = client.get("/v1/discover", params={"network": workspace["id"]},
                      headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200
    for agent in resp.json()["data"]["agents"]:
        if agent["address"] == f"openagents:{agent_name}":
            return agent
    raise AssertionError(f"{agent_name} not in discover response")


def _state_event(client, workspace, agent_name, channel, busy, busy_channels=None):
    payload = {
        "agent_name": agent_name,
        "channel": channel,
        "busy": busy,
    }
    if busy_channels is not None:
        payload["busy_channels"] = busy_channels
    return client.post("/v1/events", json={
        "type": "workspace.agent.state",
        "source": f"openagents:{agent_name}",
        "target": f"channel/{channel}",
        "payload": payload,
        "network": workspace["id"],
    }, headers={"X-Workspace-Token": workspace["token"]})


class TestAgentStateEvent:
    """workspace.agent.state → busy_channels on the membership row."""

    def test_turn_start_marks_the_channel_busy(self, client, workspace):
        _join(client, workspace, "agent-beta")

        resp = _state_event(client, workspace, "agent-beta", "general", True,
                            busy_channels=["general"])
        assert resp.status_code in (200, 201)

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == ["general"]

    def test_turn_end_clears_it(self, client, workspace):
        _join(client, workspace, "agent-beta")
        _state_event(client, workspace, "agent-beta", "general", True, ["general"])

        _state_event(client, workspace, "agent-beta", "general", False, [])

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == []

    def test_one_agent_busy_does_not_mark_another(self, client, workspace):
        """The whole point: a thread's agents each carry their own state."""
        _join(client, workspace, "agent-beta")
        _join(client, workspace, "agent-gamma")

        _state_event(client, workspace, "agent-beta", "general", True, ["general"])

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == ["general"]
        assert _agent_row(client, workspace, "agent-gamma")["busy_channels"] == []

    def test_full_set_wins_over_stale_ordering(self, client, workspace):
        """Events carry the whole busy set, so a late/duplicated one converges."""
        _join(client, workspace, "agent-beta")

        _state_event(client, workspace, "agent-beta", "general", True, ["general", "other"])
        # A turn-end for `other` that arrives with the authoritative remainder.
        _state_event(client, workspace, "agent-beta", "other", False, ["general"])
        # A duplicate of the first event replays the stale set — and is then
        # corrected by the next one, rather than sticking.
        _state_event(client, workspace, "agent-beta", "general", True, ["general"])

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == ["general"]

    def test_delta_only_event_still_moves_the_right_channel(self, client, workspace):
        """A client that omits busy_channels degrades to a per-channel delta."""
        _join(client, workspace, "agent-beta")

        _state_event(client, workspace, "agent-beta", "general", True)
        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == ["general"]

        _state_event(client, workspace, "agent-beta", "general", False)
        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == []

    def test_unknown_agent_is_ignored(self, client, workspace):
        resp = _state_event(client, workspace, "nobody", "general", True, ["general"])
        assert resp.status_code in (200, 201)


class TestHeartbeatBusyChannels:
    """The heartbeat re-asserts the full set, so a lost event self-heals."""

    def test_heartbeat_repairs_a_missed_turn_start(self, client, workspace):
        _join(client, workspace, "agent-beta")

        client.post("/v1/heartbeat", json={
            "agent_name": "agent-beta",
            "network": workspace["id"],
            "busy_channels": ["general"],
        })

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == ["general"]

    def test_heartbeat_repairs_a_missed_turn_end(self, client, workspace):
        _join(client, workspace, "agent-beta")
        _state_event(client, workspace, "agent-beta", "general", True, ["general"])

        client.post("/v1/heartbeat", json={
            "agent_name": "agent-beta",
            "network": workspace["id"],
            "busy_channels": [],
        })

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == []

    def test_older_connector_omitting_the_field_changes_nothing(self, client, workspace):
        """Absent means "no opinion" — it must not clear a real busy set."""
        _join(client, workspace, "agent-beta")
        _state_event(client, workspace, "agent-beta", "general", True, ["general"])

        client.post("/v1/heartbeat", json={
            "agent_name": "agent-beta",
            "network": workspace["id"],
        })

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == ["general"]


class TestPresenceBackstop:
    """An agent killed mid-turn never reports its turn end."""

    def test_leaving_clears_busy_channels(self, client, workspace):
        _join(client, workspace, "agent-beta")
        _state_event(client, workspace, "agent-beta", "general", True, ["general"])

        client.post("/v1/leave", json={
            "agent_name": "agent-beta",
            "network": workspace["id"],
        })

        assert _agent_row(client, workspace, "agent-beta")["busy_channels"] == []

    def test_timed_out_agent_reads_as_not_busy(self, client, workspace, db):
        """Heartbeats stopped → offline → nothing is being worked on."""
        from datetime import datetime, timedelta, timezone

        from app.models import WorkspaceMember
        from sqlalchemy import select

        _join(client, workspace, "agent-beta")
        _state_event(client, workspace, "agent-beta", "general", True, ["general"])

        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace["id"],
                WorkspaceMember.agent_name == "agent-beta",
            )
        ).scalar_one()
        member.last_heartbeat = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()

        row = _agent_row(client, workspace, "agent-beta")
        assert row["status"] == "offline"
        assert row["busy_channels"] == []
