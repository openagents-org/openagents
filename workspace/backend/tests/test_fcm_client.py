# -*- coding: utf-8 -*-
"""Provider-level reporting for the push diagnostic endpoint."""

from types import SimpleNamespace

from app.services.fcm_client import PushAlert, send_push_diagnostic


def _patch_sender(monkeypatch, sender):
    monkeypatch.setattr("app.services.fcm_client._messaging_ready", lambda: True)
    monkeypatch.setattr("app.services.fcm_client._build_message", lambda *args: object())
    monkeypatch.setattr("firebase_admin.messaging.send_each_for_multicast", sender)


def test_diagnostic_reports_unconfigured_backend(monkeypatch):
    monkeypatch.setattr("app.services.fcm_client._messaging_ready", lambda: False)

    report = send_push_diagnostic(["TOKEN"], PushAlert("title", "body"))

    assert report.configured is False
    assert report.sent_ok == []
    assert report.failures[0].code == "FCM_NOT_CONFIGURED"
    assert report.failures[0].retryable is False


def test_diagnostic_keeps_provider_message_id(monkeypatch):
    response = SimpleNamespace(
        success=True,
        message_id="projects/openagentsweb/messages/message-1",
        exception=None,
    )
    _patch_sender(
        monkeypatch,
        lambda _message: SimpleNamespace(responses=[response]),
    )

    report = send_push_diagnostic(["TOKEN"], PushAlert("title", "body"))

    assert report.sent_ok == ["TOKEN"]
    assert report.provider_message_ids == ["projects/openagentsweb/messages/message-1"]
    assert report.failures == []


def test_diagnostic_surfaces_apns_auth_rejection(monkeypatch):
    from firebase_admin import messaging

    error = messaging.ThirdPartyAuthError("APNs credentials are missing or invalid")
    response = SimpleNamespace(success=False, message_id=None, exception=error)
    _patch_sender(
        monkeypatch,
        lambda _message: SimpleNamespace(responses=[response]),
    )

    report = send_push_diagnostic(["TOKEN"], PushAlert("title", "body"))

    failure = report.failures[0]
    assert report.sent_ok == []
    assert report.dead_tokens == []
    assert failure.code == "THIRD_PARTY_AUTH_ERROR"
    assert failure.error_type == "ThirdPartyAuthError"
    assert failure.retryable is False
    assert failure.dead is False


def test_diagnostic_surfaces_retryable_batch_failure(monkeypatch):
    from firebase_admin import exceptions as fb_exceptions

    error = fb_exceptions.UnavailableError("FCM temporarily unavailable")

    def fail_batch(_message):
        raise error

    _patch_sender(monkeypatch, fail_batch)

    report = send_push_diagnostic(["TOKEN"], PushAlert("title", "body"))

    failure = report.failures[0]
    assert report.configured is True
    assert report.dead_tokens == []
    assert failure.code == "UNAVAILABLE"
    assert failure.retryable is True
    assert failure.dead is False


def test_diagnostic_redacts_token_from_provider_message(monkeypatch):
    token = "SECRET-DEVICE-TOKEN-123456"
    error = RuntimeError(f"provider rejected token {token}")

    def fail_batch(_message):
        raise error

    _patch_sender(monkeypatch, fail_batch)

    report = send_push_diagnostic([token], PushAlert("title", "body"))

    assert token not in report.failures[0].message
    assert "SECRET-D…" in report.failures[0].message


def test_ordinary_sender_keeps_legacy_tuple_contract(monkeypatch):
    from app.services.fcm_client import send_push

    response = SimpleNamespace(success=True, message_id="message-1", exception=None)
    _patch_sender(
        monkeypatch,
        lambda _message: SimpleNamespace(responses=[response]),
    )

    assert send_push(["TOKEN"], PushAlert("title", "body")) == (["TOKEN"], [])
