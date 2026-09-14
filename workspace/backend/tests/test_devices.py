# -*- coding: utf-8 -*-
"""Tests for `/v1/devices/register` and `/v1/devices/register` (DELETE)."""


class TestRegisterDevice:
    def test_register_creates_row(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": workspace["id"],
            "fcm_token": "TOKEN-A",
            "device_type": "ios",
            "bundle_id": "com.openagents.go",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert "id" in data

    def test_register_idempotent_same_token(self, client, workspace):
        body = {
            "network": workspace["id"],
            "fcm_token": "TOKEN-DUP",
            "device_type": "ios",
            "bundle_id": "com.openagents.go",
        }
        h = {"X-Workspace-Token": workspace["token"]}
        r1 = client.post("/v1/devices/register", json=body, headers=h)
        r2 = client.post("/v1/devices/register", json=body, headers=h)
        assert r1.status_code == 200 and r2.status_code == 200
        # Same row updated, not duplicated.
        assert r1.json()["data"]["id"] == r2.json()["data"]["id"]

    def test_register_different_tokens_create_separate_rows(self, client, workspace):
        h = {"X-Workspace-Token": workspace["token"]}
        r1 = client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-X",
            "device_type": "ios", "bundle_id": "com.openagents.go",
        }, headers=h)
        r2 = client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-Y",
            "device_type": "ios", "bundle_id": "com.openagents.go",
        }, headers=h)
        assert r1.json()["data"]["id"] != r2.json()["data"]["id"]

    def test_register_rejects_missing_token(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": workspace["id"],
            "fcm_token": "TOKEN-A",
        })
        assert resp.status_code == 401

    def test_register_rejects_wrong_token(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": workspace["id"],
            "fcm_token": "TOKEN-A",
        }, headers={"X-Workspace-Token": "wrong"})
        assert resp.status_code == 401

    def test_register_stores_prefs(self, client, workspace, db):
        from app.models import DeviceToken

        prefs = {
            "approvals": True, "mentions": True, "agentErrors": True,
            "taskCompletions": True, "allMessages": False, "quietHours": False,
        }
        resp = client.post("/v1/devices/register", json={
            "network": workspace["id"],
            "fcm_token": "TOKEN-PREFS",
            "device_type": "android",
            "prefs": prefs,
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200, resp.text
        row = db.query(DeviceToken).filter_by(fcm_token="TOKEN-PREFS").one()
        assert row.prefs == prefs
        assert row.device_type == "android"

    def test_reregister_without_prefs_keeps_stored_prefs(self, client, workspace, db):
        # An older client build, or a re-register triggered by token refresh,
        # must not wipe the switches the user set.
        from app.models import DeviceToken

        h = {"X-Workspace-Token": workspace["token"]}
        client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-KEEP",
            "prefs": {"allMessages": True},
        }, headers=h)
        client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-KEEP",
        }, headers=h)
        row = db.query(DeviceToken).filter_by(fcm_token="TOKEN-KEEP").one()
        assert row.prefs == {"allMessages": True}

    def test_register_without_prefs_is_null(self, client, workspace, db):
        from app.models import DeviceToken

        client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-NOPREFS",
        }, headers={"X-Workspace-Token": workspace["token"]})
        row = db.query(DeviceToken).filter_by(fcm_token="TOKEN-NOPREFS").one()
        assert row.prefs is None

    def test_register_404_on_unknown_network(self, client, workspace):
        resp = client.post("/v1/devices/register", json={
            "network": "does-not-exist",
            "fcm_token": "TOKEN-A",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 404


class TestDeregisterDevice:
    def test_deregister_removes_row(self, client, workspace):
        h = {"X-Workspace-Token": workspace["token"]}
        client.post("/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-D",
            "device_type": "ios",
        }, headers=h)
        resp = client.request("DELETE", "/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN-D",
        }, headers=h)
        assert resp.status_code == 200
        assert resp.json()["data"]["deleted"] == 1

    def test_deregister_unknown_token_no_op(self, client, workspace):
        h = {"X-Workspace-Token": workspace["token"]}
        resp = client.request("DELETE", "/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "NEVER-REGISTERED",
        }, headers=h)
        assert resp.status_code == 200
        assert resp.json()["data"]["deleted"] == 0

    def test_deregister_requires_auth(self, client, workspace):
        resp = client.request("DELETE", "/v1/devices/register", json={
            "network": workspace["id"], "fcm_token": "TOKEN",
        })
        assert resp.status_code == 401


class TestTestPush:
    """`/v1/devices/test-push` — the one-button push diagnosis.

    `send_push` is patched throughout: these cover the endpoint's gating
    and its report, not FCM delivery, and an unpatched call would try to
    reach Google from the test suite.
    """

    def _register(self, client, workspace, token="TOKEN-TP", **extra):
        body = {
            "network": workspace["id"], "fcm_token": token,
            "device_type": "ios",
        }
        body.update(extra)
        return client.post("/v1/devices/register", json=body,
                           headers={"X-Workspace-Token": workspace["token"]})

    def test_sends_to_the_named_device(self, client, workspace, monkeypatch):
        self._register(client, workspace)
        calls = []

        def fake_send(tokens, alert, data=None):
            calls.append((list(tokens), alert, data))
            return list(tokens), []

        monkeypatch.setattr("app.services.fcm_client.send_push", fake_send)
        monkeypatch.setattr("app.services.fcm_client._messaging_ready", lambda: True)

        resp = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-TP",
            "reason": "mention", "channel": "general",
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["sent"] is True
        assert data["configured"] is True
        # Exactly one device woken — the one asked for, nobody else's.
        assert len(calls) == 1
        assert calls[0][0] == ["TOKEN-TP"]
        # Payload matches the real fan-out's shape so the tap handler is
        # exercised for real.
        assert calls[0][2]["reason"] == "mention"
        assert calls[0][2]["channel"] == "general"

    def test_unregistered_token_is_refused(self, client, workspace, monkeypatch):
        sent = []
        monkeypatch.setattr(
            "app.services.fcm_client.send_push",
            lambda tokens, alert, data=None: (sent.extend(tokens), ([], []))[1],
        )
        resp = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "SOMEONE-ELSES-TOKEN",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 404
        # The point of the refusal: an arbitrary token never reaches FCM.
        assert sent == []

    def test_requires_auth(self, client, workspace):
        resp = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-TP",
        })
        assert resp.status_code == 401

    def test_reports_unconfigured_deployment(self, client, workspace, monkeypatch):
        self._register(client, workspace, token="TOKEN-NOFCM")
        # What a deployment with no FIREBASE_CREDENTIALS_JSON actually
        # does: returns empty-empty, indistinguishable from success
        # unless `configured` is reported separately. That's the bug this
        # endpoint exists to make visible.
        monkeypatch.setattr("app.services.fcm_client._messaging_ready", lambda: False)
        monkeypatch.setattr(
            "app.services.fcm_client.send_push",
            lambda tokens, alert, data=None: ([], []),
        )
        resp = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-NOFCM",
        }, headers={"X-Workspace-Token": workspace["token"]})
        data = resp.json()["data"]
        assert data["configured"] is False
        assert data["sent"] is False

    def test_reports_prefs_that_would_have_muted_it(self, client, workspace, monkeypatch):
        self._register(
            client, workspace, token="TOKEN-MUTED",
            prefs={"taskCompletions": False, "mentions": True},
        )
        monkeypatch.setattr("app.services.fcm_client._messaging_ready", lambda: True)
        monkeypatch.setattr(
            "app.services.fcm_client.send_push",
            lambda tokens, alert, data=None: (list(tokens), []),
        )
        h = {"X-Workspace-Token": workspace["token"]}

        muted = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-MUTED",
            "reason": "task_completed",
        }, headers=h).json()["data"]
        # Still sent — a test push bypasses the switches on purpose — but
        # the report says an ordinary one would have been dropped.
        assert muted["sent"] is True
        assert muted["prefs_would_allow"] is False

        allowed = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-MUTED",
            "reason": "mention",
        }, headers=h).json()["data"]
        assert allowed["prefs_would_allow"] is True

    def test_dead_token_is_pruned(self, client, workspace, monkeypatch):
        self._register(client, workspace, token="TOKEN-DEAD")
        monkeypatch.setattr("app.services.fcm_client._messaging_ready", lambda: True)
        monkeypatch.setattr(
            "app.services.fcm_client.send_push",
            lambda tokens, alert, data=None: ([], list(tokens)),
        )
        h = {"X-Workspace-Token": workspace["token"]}
        data = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-DEAD",
        }, headers=h).json()["data"]
        assert data["token_dead"] is True
        # Row is gone, so the next call can't find it.
        again = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-DEAD",
        }, headers=h)
        assert again.status_code == 404

    def test_missing_email_is_surfaced(self, client, workspace, monkeypatch):
        # Registered without user_email — invisible to mention/chat pushes
        # in the real fan-out no matter what this endpoint manages to send.
        self._register(client, workspace, token="TOKEN-NOEMAIL")
        monkeypatch.setattr("app.services.fcm_client._messaging_ready", lambda: True)
        monkeypatch.setattr(
            "app.services.fcm_client.send_push",
            lambda tokens, alert, data=None: (list(tokens), []),
        )
        data = client.post("/v1/devices/test-push", json={
            "network": workspace["id"], "fcm_token": "TOKEN-NOEMAIL",
        }, headers={"X-Workspace-Token": workspace["token"]}).json()["data"]
        assert data["sent"] is True
        assert data["user_email"] is None
