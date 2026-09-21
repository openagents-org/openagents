# -*- coding: utf-8 -*-
"""Server-side PostHog analytics: payload shape, identity resolution, no-op behaviour."""

from app.config import config
from app.services import analytics


def test_build_payload_has_server_marker_and_person_props():
    body = analytics.build_payload("Alice@Example.com", "account_created", {"provider": "google", "skip": None}, {"email": "a@b.c"})
    assert body["event"] == "account_created"
    assert body["distinct_id"] == "Alice@Example.com"  # lowercasing happens in capture()
    assert body["properties"]["source"] == "server"
    assert body["properties"]["$lib"] == analytics.LIB_NAME
    assert body["properties"]["provider"] == "google"
    assert "skip" not in body["properties"]
    assert body["properties"]["$set"] == {"email": "a@b.c"}
    assert body["api_key"] == config.POSTHOG_API_KEY


def test_capture_lowercases_and_posts(monkeypatch):
    sent = {}
    class Resp:
        status_code = 200
        text = ""
    def fake_post(url, json=None, timeout=None):
        sent["url"] = url; sent["json"] = json; return Resp()
    monkeypatch.setattr(analytics.httpx, "post", fake_post)
    monkeypatch.setattr(config, "ANALYTICS_ENABLED", True)
    monkeypatch.setattr(config, "POSTHOG_API_KEY", "phc_test")
    assert analytics.capture("  Bob@X.io ", "message_posted", {"workspace_id": "abc"}, blocking=True) is True
    assert sent["url"].endswith("/capture/")
    assert sent["json"]["distinct_id"] == "bob@x.io"
    assert sent["json"]["properties"]["workspace_id"] == "abc"


def test_capture_noop_when_disabled_or_no_identity(monkeypatch):
    calls = []
    monkeypatch.setattr(analytics.httpx, "post", lambda *a, **k: calls.append(1))
    monkeypatch.setattr(config, "ANALYTICS_ENABLED", False)
    assert analytics.capture("x@y.z", "account_created", blocking=True) is False
    monkeypatch.setattr(config, "ANALYTICS_ENABLED", True)
    assert analytics.capture("", "account_created", blocking=True) is False
    assert calls == []


def test_sender_email_resolution():
    f = analytics.sender_email_for_event
    assert f("human:Dana@Q.com", {}, {}) == "dana@q.com"
    # display-name source, email carried in payload (embedded / mobile clients)
    assert f("human:Dana Lee", {"sender_email": "Dana@Q.com"}, {}) == "dana@q.com"
    assert f("human:Dana Lee", {"sender_id": "dana@q.com"}, {}) == "dana@q.com"
    assert f("human:Dana Lee", {}, {"sender_email": "dana@q.com"}) == "dana@q.com"
    # anonymous / agents / system are not people
    assert f("human:user", {}, {}) is None
    assert f("openagents:coder", {"sender_email": "x@y.z"}, {}) is None
    assert f("system:timer", {}, {}) is None


def test_track_message_posted_only_for_humans(monkeypatch):
    seen = []
    monkeypatch.setattr(analytics, "capture", lambda d, e, p=None, s=None, **k: seen.append((d, e, p)) or True)
    analytics.track_message_posted("ws1", {"source": "openagents:bot", "target": "channel/c", "payload": {"content": "hi"}})
    analytics.track_message_posted("ws1", {"source": "human:eve@z.io", "target": "channel/general", "payload": {"content": "hi", "mentions": ["a"]}, "metadata": {}})
    assert len(seen) == 1
    d, e, p = seen[0]
    assert (d, e) == ("eve@z.io", "message_posted")
    assert p["workspace_id"] == "ws1" and p["target_kind"] == "channel" and p["has_mentions"] is True
