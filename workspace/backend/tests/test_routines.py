# -*- coding: utf-8 -*-
"""
Tests for routine schedule modes (daily + interval).
"""

from datetime import datetime, timezone

from app.routers.routines import _compute_next_fires_at


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _create_payload(workspace, **overrides):
    base = {
        "name": "Test routine",
        "message": "ping",
        "context": "routine background",
        "network": workspace["id"],
        "channel": workspace["channel"]["name"],
        "source": "openagents:agent-alpha",
    }
    base.update(overrides)
    return base


class TestComputeNextFires:
    def test_interval_mode_uses_now_plus_n(self):
        before = datetime.now(timezone.utc)
        result = _compute_next_fires_at(None, None, None, 5)
        after = datetime.now(timezone.utc)
        delta = (result - before).total_seconds()
        upper = (after - before).total_seconds() + 5 * 60
        assert 5 * 60 - 1 <= delta <= upper + 1

    def test_daily_mode_unchanged(self):
        # Future time today should be picked.
        now = datetime.now(timezone.utc)
        future_hour = (now.hour + 1) % 24
        result = _compute_next_fires_at(future_hour, 0, None, None)
        assert result.hour == future_hour
        assert result.minute == 0


class TestCreateRoutine:
    def test_create_routine_emits_bootstrap_for_routine_channel(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, interval_minutes=15),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]

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
            and e["target"] == "openagents:agent-alpha"
            and e["payload"]["channel"] == data["channel_name"]
        ]
        assert bootstraps
        assert bootstraps[0]["payload"]["reason"] == "routine_create"

    def test_create_daily_mode(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, hour=8, minute=30),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["schedule_hour"] == 8
        assert data["schedule_minute"] == 30
        assert data["schedule_interval_minutes"] is None

    def test_create_interval_mode(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, interval_minutes=15),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["schedule_interval_minutes"] == 15
        assert data["schedule_hour"] is None
        assert data["schedule_minute"] is None

    def test_routes_into_per_agent_channel(self, client, workspace):
        """Routine should land in a dedicated routine:<id> channel, regardless of caller's channel."""
        resp = client.post(
            "/v1/routines",
            json=_create_payload(
                workspace,
                interval_minutes=15,
                channel="some-other-channel",  # explicitly ignored
                source="openagents:agent-alpha",
            ),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["channel_name"].startswith("routine:")
        assert data["channel_name"].endswith(data["id"])
        assert data["created_by"] == "agent-alpha"  # bare, no prefix

    def test_bare_source_also_normalized(self, client, workspace):
        """Caller sending bare name (no openagents: prefix) still works."""
        resp = client.post(
            "/v1/routines",
            json=_create_payload(
                workspace,
                interval_minutes=10,
                source="agent-alpha",
            ),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["channel_name"].startswith("routine:")
        assert data["channel_name"].endswith(data["id"])
        assert data["created_by"] == "agent-alpha"

    def test_routine_channel_is_dedicated_per_routine(self, client, workspace):
        """Two routines for the same agent get separate routine channels."""
        for i in range(2):
            client.post(
                "/v1/routines",
                json=_create_payload(workspace, interval_minutes=5 + i),
                headers=_headers(workspace),
            )
        resp = client.get(
            f"/v1/routines?network={workspace['id']}",
            headers=_headers(workspace),
        )
        routines = resp.json()["data"]["routines"]
        assert len(routines) == 2
        channels = {r["channel_name"] for r in routines}
        assert len(channels) == 2
        assert all(ch.startswith("routine:") for ch in channels)
        assert channels == {f"routine:{r['id']}" for r in routines}

    def test_reject_both_modes(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, hour=8, minute=0, interval_minutes=15),
            headers=_headers(workspace),
        )
        assert resp.status_code == 400

    def test_reject_neither_mode(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace),
            headers=_headers(workspace),
        )
        assert resp.status_code == 400

    def test_reject_interval_with_days(self, client, workspace):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, interval_minutes=15, days=[0, 1]),
            headers=_headers(workspace),
        )
        assert resp.status_code == 400

    def test_reject_interval_out_of_range(self, client, workspace):
        for bad in (0, 1441):
            resp = client.post(
                "/v1/routines",
                json=_create_payload(workspace, interval_minutes=bad),
                headers=_headers(workspace),
            )
            assert resp.status_code == 400, f"interval_minutes={bad} should be rejected"

    def test_rejects_non_member_source(self, client, workspace):
        """Source must be a real workspace member; rejects impersonation."""
        resp = client.post(
            "/v1/routines",
            json=_create_payload(
                workspace,
                interval_minutes=15,
                source="openagents:not-a-real-agent",
            ),
            headers=_headers(workspace),
        )
        assert resp.status_code == 403, resp.text
        assert "not a member" in resp.json()["message"].lower()

    def test_list_includes_interval_field(self, client, workspace):
        client.post(
            "/v1/routines",
            json=_create_payload(workspace, interval_minutes=30),
            headers=_headers(workspace),
        )
        resp = client.get(
            f"/v1/routines?network={workspace['id']}",
            headers=_headers(workspace),
        )
        assert resp.status_code == 200
        routines = resp.json()["data"]["routines"]
        assert len(routines) == 1
        assert routines[0]["schedule_interval_minutes"] == 30
