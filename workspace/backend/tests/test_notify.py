# -*- coding: utf-8 -*-
"""
Tests for the inbox-notification path: `services/notify.notify`, the fan-out
it triggers (`push.fanout_for_notification`), and the endpoints the mobile
inbox screen reads.

The push itself is never sent here — `fcm_client.send_push` is patched out in
every test that reaches it, and the thread `notify` would spawn is replaced by
a direct call so the assertion is deterministic.
"""

import pytest

from app.models import DeviceToken, NotificationRecord


@pytest.fixture
def captured_push(monkeypatch):
    """Capture what would have been pushed, instead of pushing it.

    Patches the dispatch hop rather than FCM so the test also pins *when* the
    push is fired — the whole point of the `after_commit` hook.
    """
    sent = []
    import app.services.notify as notify_mod

    monkeypatch.setattr(notify_mod, "_dispatch", lambda snapshot: sent.append(snapshot))
    return sent


def _device(db, workspace_id: str, token: str = "TOKEN-1", prefs=None, email="test@example.com"):
    row = DeviceToken(
        workspace_id=workspace_id,
        fcm_token=token,
        device_type="android",
        bundle_id="org.openagents.mobile",
        user_email=email,
        prefs=prefs,
    )
    db.add(row)
    db.commit()
    return row


class TestNotifyFilesAndPushes:
    def test_record_is_written(self, db, workspace, captured_push):
        from app.services.notify import notify

        record = notify(
            db, workspace["id"],
            source="openagents:alpha",
            title="Task completed",
            message="“Ship it” was completed by alpha.",
            channel_name="task-1",
        )
        db.commit()

        stored = db.query(NotificationRecord).filter_by(id=record.id).one()
        assert stored.title == "Task completed"
        assert stored.channel_name == "task-1"
        assert stored.is_read is False

    def test_push_fires_only_after_commit(self, db, workspace, captured_push):
        from app.services.notify import notify

        notify(
            db, workspace["id"],
            source="openagents:alpha", title="t", message="m",
        )
        # Still in the caller's transaction — the phone must not know yet.
        assert captured_push == []

        db.commit()
        assert len(captured_push) == 1
        assert captured_push[0]["title"] == "t"

    def test_rollback_sends_nothing(self, db, workspace, captured_push):
        from app.services.notify import notify

        notify(db, workspace["id"], source="system:test", title="t", message="m")
        db.rollback()
        assert captured_push == []

    def test_push_false_files_without_sending(self, db, workspace, captured_push):
        from app.services.notify import notify

        record = notify(
            db, workspace["id"],
            source="system:campaign", title="credits", message="m", push=False,
        )
        db.commit()

        assert db.query(NotificationRecord).filter_by(id=record.id).count() == 1
        assert captured_push == []

    def test_reason_defaults_to_task_completed(self, db, workspace, captured_push):
        from app.services.notify import notify

        notify(db, workspace["id"], source="system:test", title="t", message="m")
        db.commit()
        assert captured_push[0]["reason"] == "task_completed"

    def test_explicit_reason_is_carried(self, db, workspace, captured_push):
        from app.services.notify import notify

        notify(
            db, workspace["id"],
            source="system:test", title="t", message="m",
            priority="high", reason="approval",
        )
        db.commit()
        assert captured_push[0]["reason"] == "approval"

    def test_high_priority_alone_does_not_become_approval(self, db, workspace, captured_push):
        """Muting "Approval Requests" must not silence urgent errors."""
        from app.services.notify import notify

        notify(
            db, workspace["id"],
            source="system:test", title="t", message="m", priority="high",
        )
        db.commit()
        assert captured_push[0]["reason"] == "task_completed"


class TestFanoutForNotification:
    def _fanout(self, monkeypatch, snapshot):
        """Run the real fan-out against the test database.

        `fanout_for_notification` opens its own session — it normally runs on a
        thread, long after the request's session is gone — so the module's
        `SessionLocal` is pointed at the in-memory engine for the duration.
        """
        from tests.conftest import TestingSessionLocal

        calls = []
        import app.services.push as push_mod

        monkeypatch.setattr(push_mod, "SessionLocal", TestingSessionLocal)
        monkeypatch.setattr(
            push_mod, "send_push",
            lambda tokens, alert, data: (calls.append((tokens, alert, data)), ([], []))[1],
        )
        push_mod.fanout_for_notification(snapshot)
        return calls

    def _snapshot(self, workspace_id, **over):
        base = {
            "id": "notif-1",
            "workspace_id": workspace_id,
            "title": "Task needs your input",
            "message": "“Ship it” is blocked.",
            "priority": "high",
            "channel_name": "task-1",
            "source": "openagents:alpha",
            "reason": "approval",
        }
        base.update(over)
        return base

    def test_sends_to_workspace_devices(self, db, workspace, monkeypatch):
        _device(db, workspace["id"], "TOKEN-A")
        calls = self._fanout(monkeypatch, self._snapshot(workspace["id"]))

        assert len(calls) == 1
        tokens, alert, data = calls[0]
        assert tokens == ["TOKEN-A"]
        assert alert.title == "Task needs your input"
        assert alert.body == "“Ship it” is blocked."

    def test_payload_carries_notification_id_and_channel(self, db, workspace, monkeypatch):
        _device(db, workspace["id"], "TOKEN-A")
        _tokens, _alert, data = self._fanout(
            monkeypatch, self._snapshot(workspace["id"]),
        )[0]

        # The id opens the detail screen; the channel is what older builds
        # (and the "open the thread" action) route on.
        assert data["notification_id"] == "notif-1"
        assert data["channel"] == "task-1"
        assert data["reason"] == "approval"
        assert data["event_type"] == "workspace.notification"

    def test_muted_switch_drops_the_device(self, db, workspace, monkeypatch):
        _device(db, workspace["id"], "TOKEN-A", prefs={"approvals": False})
        assert self._fanout(monkeypatch, self._snapshot(workspace["id"])) == []

    def test_unrelated_switch_does_not_drop_it(self, db, workspace, monkeypatch):
        _device(db, workspace["id"], "TOKEN-A", prefs={"allMessages": False})
        assert len(self._fanout(monkeypatch, self._snapshot(workspace["id"]))) == 1

    def test_no_devices_is_a_no_op(self, db, workspace, monkeypatch):
        assert self._fanout(monkeypatch, self._snapshot(workspace["id"])) == []

    def test_long_message_is_truncated(self, db, workspace, monkeypatch):
        _device(db, workspace["id"], "TOKEN-A")
        snapshot = self._snapshot(workspace["id"], message="x" * 500)
        _tokens, alert, _data = self._fanout(monkeypatch, snapshot)[0]
        # 237 + the ellipsis, matching `_build_alert` on the event path.
        assert len(alert.body) == 238 and alert.body.endswith("…")


class TestNotificationEndpoints:
    def test_create_pushes(self, client, workspace, captured_push):
        resp = client.post("/v1/notifications", json={
            "network": workspace["id"],
            "source": "openagents:alpha",
            "title": "Deploy finished",
            "message": "staging is live",
            "channel": "ops",
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200, resp.text
        assert len(captured_push) == 1
        assert captured_push[0]["channel_name"] == "ops"

    def test_create_honours_push_false(self, client, workspace, captured_push):
        resp = client.post("/v1/notifications", json={
            "network": workspace["id"],
            "source": "system:test",
            "title": "quiet",
            "message": "m",
            "push": False,
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        assert captured_push == []
        assert resp.json()["data"]["title"] == "quiet"

    def test_get_one(self, client, workspace, captured_push):
        created = client.post("/v1/notifications", json={
            "network": workspace["id"],
            "source": "openagents:alpha",
            "title": "Deploy finished",
            "message": "staging is live",
        }, headers={"X-Workspace-Token": workspace["token"]}).json()["data"]

        resp = client.get(
            f"/v1/notifications/{created['id']}",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["message"] == "staging is live"

    def test_get_one_requires_credentials(self, client, workspace, captured_push):
        created = client.post("/v1/notifications", json={
            "network": workspace["id"],
            "source": "openagents:alpha",
            "title": "t",
            "message": "m",
        }, headers={"X-Workspace-Token": workspace["token"]}).json()["data"]

        assert client.get(f"/v1/notifications/{created['id']}").status_code == 401
        assert client.get(
            f"/v1/notifications/{created['id']}",
            headers={"X-Workspace-Token": "wrong"},
        ).status_code == 401

    def test_get_one_unknown_id(self, client, workspace):
        resp = client.get(
            "/v1/notifications/does-not-exist",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404


class TestSendFollowsTheRecord:
    """The push must track the committed row, not the armed listener.

    `after_commit` with `once=True` is not disarmed by a rollback, so a caller
    that rolls the INSERT back and later commits unrelated work in the same
    session still fires the hook. `_send` therefore re-checks the database on
    a fresh session before fanning out.
    """

    @pytest.fixture
    def fanned_out(self, monkeypatch):
        calls = []
        import app.services.notify as notify_mod
        import app.services.push as push_mod
        from tests.conftest import TestingSessionLocal

        # `_send` opens its own session, exactly like the fan-out does — point
        # it at the shared in-memory test database the same way test_push does.
        monkeypatch.setattr(notify_mod, "SessionLocal", TestingSessionLocal)
        monkeypatch.setattr(push_mod, "fanout_for_notification", lambda snap: calls.append(snap))
        return calls

    def test_send_skips_when_the_record_is_gone(self, db, workspace, fanned_out):
        from app.services.notify import _send

        _send({"id": "does-not-exist", "workspace_id": workspace["id"], "title": "t", "message": "m"})
        assert fanned_out == []

    def test_send_fans_out_when_the_record_exists(self, db, workspace, fanned_out):
        from app.services.notify import _send, notify

        record = notify(db, workspace["id"], source="system:test", title="t", message="m", push=False)
        db.commit()
        _send({"id": record.id, "workspace_id": workspace["id"], "title": "t", "message": "m"})
        assert [c["id"] for c in fanned_out] == [record.id]

    def test_rollback_then_unrelated_commit_sends_nothing(self, db, workspace, fanned_out, monkeypatch):
        """End to end: the stale listener fires, and the re-check stops it."""
        import app.services.notify as notify_mod
        from app.services.notify import notify

        # Run the hook synchronously so the assertion is deterministic.
        monkeypatch.setattr(notify_mod, "_dispatch", notify_mod._send)

        notify(db, workspace["id"], source="system:test", title="t", message="m")
        db.rollback()
        # Unrelated work in the same session — this commit fires the armed hook.
        db.add(NotificationRecord(workspace_id=workspace["id"], created_by="system:other",
                                  title="other", message="x", priority="normal"))
        db.commit()
        assert fanned_out == []
