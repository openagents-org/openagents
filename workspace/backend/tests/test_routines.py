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
        """Routine should land in routines:<agent>, regardless of caller's channel."""
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
        assert data["channel_name"] == "routines:agent-alpha"
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
        assert data["channel_name"] == "routines:agent-alpha"
        assert data["created_by"] == "agent-alpha"

    def test_routine_channel_reused_across_routines(self, client, workspace):
        """Two routines for the same agent share one channel."""
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
        assert {r["channel_name"] for r in routines} == {"routines:agent-alpha"}

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


class TestUpdateRoutine:
    def _create(self, client, workspace, **overrides):
        resp = client.post(
            "/v1/routines",
            json=_create_payload(workspace, **overrides),
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["data"]

    def _patch(self, client, workspace, routine_id, **body):
        body.setdefault("network", workspace["id"])
        return client.patch(
            f"/v1/routines/{routine_id}",
            json=body,
            headers=_headers(workspace),
        )

    def test_edit_keeps_id_and_history(self, client, workspace):
        """The whole point of editing — the routine stays the same row."""
        created = self._create(client, workspace, hour=8, minute=30)
        resp = self._patch(client, workspace, created["id"], name="Renamed", hour=10)
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["id"] == created["id"]
        assert data["name"] == "Renamed"
        assert data["schedule_hour"] == 10
        assert data["schedule_minute"] == 30  # untouched half kept

    def test_edit_days_only_keeps_time(self, client, workspace):
        created = self._create(client, workspace, hour=8, minute=30, days=[0, 1, 2])
        data = self._patch(client, workspace, created["id"], days=[5, 6]).json()["data"]
        assert data["schedule_days"] == [5, 6]
        assert data["schedule_hour"] == 8
        assert data["schedule_minute"] == 30

    def test_switch_daily_to_interval_clears_daily_fields(self, client, workspace):
        created = self._create(client, workspace, hour=8, minute=30, days=[0, 1])
        data = self._patch(client, workspace, created["id"], interval_minutes=30).json()["data"]
        assert data["schedule_interval_minutes"] == 30
        assert data["schedule_hour"] is None
        assert data["schedule_minute"] is None
        assert data["schedule_days"] is None

    def test_switch_interval_to_daily_needs_both_halves(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        resp = self._patch(client, workspace, created["id"], hour=9)
        assert resp.status_code == 400
        data = self._patch(client, workspace, created["id"], hour=9, minute=15).json()["data"]
        assert data["schedule_hour"] == 9
        assert data["schedule_minute"] == 15
        assert data["schedule_interval_minutes"] is None

    def test_schedule_edit_recomputes_next_fire(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=1440)
        data = self._patch(client, workspace, created["id"], interval_minutes=1).json()["data"]
        assert data["next_fires_at"] < created["next_fires_at"]

    def test_reassign_to_another_agent_moves_channel(self, client, workspace, db):
        from app.models import WorkspaceMember

        db.add(WorkspaceMember(workspace_id=workspace["id"], agent_name="agent-beta"))
        db.commit()

        created = self._create(client, workspace, interval_minutes=30)
        assert created["channel_name"] == "routines:agent-alpha"
        data = self._patch(
            client, workspace, created["id"], source="openagents:agent-beta",
        ).json()["data"]
        assert data["created_by"] == "agent-beta"
        assert data["channel_name"] == "routines:agent-beta"

    def test_reject_reassign_to_non_member(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        resp = self._patch(client, workspace, created["id"], source="openagents:nope")
        assert resp.status_code == 403

    def test_reject_both_schedule_modes(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        resp = self._patch(client, workspace, created["id"], hour=8, minute=0, interval_minutes=15)
        assert resp.status_code == 400

    def test_reject_interval_out_of_range(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        for bad in (0, 1441):
            assert self._patch(client, workspace, created["id"], interval_minutes=bad).status_code == 400

    def test_pause_and_resume(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        paused = self._patch(client, workspace, created["id"], status="paused").json()["data"]
        assert paused["status"] == "paused"

        # Paused routines stay listed, otherwise nothing could resume them.
        listed = client.get(
            f"/v1/routines?network={workspace['id']}", headers=_headers(workspace),
        ).json()["data"]["routines"]
        assert [r["id"] for r in listed] == [created["id"]]

        resumed = self._patch(client, workspace, created["id"], status="active").json()["data"]
        assert resumed["status"] == "active"
        # Resuming re-arms the schedule instead of firing on a stale timestamp.
        assert resumed["next_fires_at"] > paused["next_fires_at"]

    def test_reject_unknown_status(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        assert self._patch(client, workspace, created["id"], status="cancelled").status_code == 400

    def test_cancelled_routine_cannot_be_edited(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        client.delete(f"/v1/routines/{created['id']}", headers=_headers(workspace))
        resp = self._patch(client, workspace, created["id"], name="Back from the dead")
        assert resp.status_code == 400

    def test_cancelled_routine_stays_out_of_the_list(self, client, workspace):
        created = self._create(client, workspace, interval_minutes=30)
        client.delete(f"/v1/routines/{created['id']}", headers=_headers(workspace))
        listed = client.get(
            f"/v1/routines?network={workspace['id']}", headers=_headers(workspace),
        ).json()["data"]["routines"]
        assert listed == []

    def test_unknown_routine_is_404(self, client, workspace):
        assert self._patch(client, workspace, "no-such-routine", name="x").status_code == 404

    def test_task_edit_refreshes_the_generated_context(self, client, workspace, monkeypatch):
        """The context is what the agent reads when it fires — it can't keep
        describing the task the routine used to have."""
        from app.routers import routines as routines_module

        monkeypatch.setattr(
            routines_module, "_generate_routine_context_sync",
            lambda name, message, schedule_desc, history=None: f"generated for: {message}",
        )
        created = self._create(client, workspace, interval_minutes=30)
        data = self._patch(client, workspace, created["id"], message="new task").json()["data"]
        assert data["context"] == "generated for: new task"

    def test_explicit_context_is_not_regenerated(self, client, workspace, monkeypatch):
        from app.routers import routines as routines_module

        monkeypatch.setattr(
            routines_module, "_generate_routine_context_sync",
            lambda *a, **k: "should not be used",
        )
        created = self._create(client, workspace, interval_minutes=30)
        data = self._patch(
            client, workspace, created["id"], message="new task", context="hand written",
        ).json()["data"]
        assert data["context"] == "hand written"

    def test_untouched_fields_survive(self, client, workspace):
        created = self._create(client, workspace, hour=8, minute=30, days=[0, 1])
        data = self._patch(client, workspace, created["id"], status="paused").json()["data"]
        assert data["name"] == created["name"]
        assert data["message"] == created["message"]
        assert data["context"] == created["context"]
        assert data["schedule_hour"] == 8
        assert data["schedule_days"] == [0, 1]
