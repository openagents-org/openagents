"""Regressions for concurrent identity creation, browser recovery and idle SSE."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette.middleware.gzip import GZipMiddleware
from starlette.requests import Request

from app import access
from app.browser import BrowserManager, guard_browser_url
from app.models import BrowserContext, BrowserTab, User
from app.net_security import UnsafeURLError
from app.routers import browser, events


def _miss_first_lookup(db, monkeypatch):
    """Simulate a stale SELECT; the subsequent INSERT hits the real constraint."""
    execute = db.execute
    missed = False

    def execute_after_race(*args, **kwargs):
        nonlocal missed
        if not missed:
            missed = True
            return SimpleNamespace(scalar_one_or_none=lambda: None)
        return execute(*args, **kwargs)

    monkeypatch.setattr(db, "execute", execute_after_race)


@pytest.mark.parametrize("invite", [False, True])
def test_user_creation_race_preserves_outer_transaction(db, monkeypatch, invite):
    winner = User(email="race@example.com", display_name="Existing name")
    db.add(winner)
    db.commit()
    winner_id = winner.id
    pending = User(email="unrelated@example.com")
    db.add(pending)
    analytics = MagicMock()
    monkeypatch.setattr("app.services.analytics.track_account_created", analytics)
    _miss_first_lookup(db, monkeypatch)
    if invite:
        user = access.get_or_create_user_by_email(db, " RACE@example.com ")
    else:
        user = access.get_or_create_user(db, {
            "email": " RACE@example.com ", "firebase_uid": "verified-uid",
            "email_verified": True, "display_name": "Do not overwrite",
        })
        assert user.firebase_uid == "verified-uid"
        assert user.email_verified_at is not None
        assert user.last_login_at is not None
    assert user.id == winner_id
    assert user.display_name == "Existing name"
    analytics.assert_not_called()
    db.commit()
    assert db.execute(select(User).where(User.email == pending.email)).scalar_one().id == pending.id
    assert len(db.execute(select(User)).scalars().all()) == 2


def test_user_creation_does_not_swallow_other_constraints(db):
    winner = User(email="existing@example.com")
    db.add(winner)
    db.commit()
    candidate = User(id=winner.id, email="different@example.com")
    db.expunge(winner)
    with pytest.raises(IntegrityError):
        access._insert_user_or_get_winner(db, candidate)
    assert db.execute(select(User)).scalar_one().email == "existing@example.com"


@pytest.mark.parametrize("invite", [False, True])
def test_new_user_remains_owned_by_caller_transaction(db, invite):
    if invite:
        access.get_or_create_user_by_email(db, "rollback@example.com")
    else:
        access.get_or_create_user(db, {"email": "rollback@example.com"})
    db.rollback()
    assert db.execute(select(User)).scalar_one_or_none() is None


def test_campaign_status_survives_first_login_race(db, monkeypatch):
    from app.routers import campaign as route
    db.add(User(email="race@example.com"))
    db.commit()
    _miss_first_lookup(db, monkeypatch)
    monkeypatch.setattr(access, "verify_identity_claims", lambda _: {
        "email": "race@example.com", "email_verified": True,
    })
    monkeypatch.setattr(route.campaign, "enabled", lambda: True)
    monkeypatch.setattr(route.campaign, "ineligible_reason", lambda _: None)
    monkeypatch.setattr(route.campaign, "status_payload", lambda *_: {"enabled": True})
    response = route.campaign_status(authorization="Bearer test", db=db)
    assert response["data"]["enabled"] is True


@pytest.fixture
def dead_browser(db, workspace, monkeypatch):
    context = BrowserContext(workspace_id=workspace["id"], name="Saved", bb_context_id="saved-cookies", created_by="human:test")
    db.add(context)
    db.flush()
    tab = BrowserTab(workspace_id=workspace["id"], context_id=context.id,
                     url="chrome-error://chromewebdata/", session_id="dead-session",
                     status="active", created_by="human:test")
    db.add(tab)
    db.commit()
    mgr = MagicMock()
    mgr._pages = {}
    mgr._sessions = {}
    mgr._live_urls = {}
    mgr.reconnect = AsyncMock()
    mgr.probe_session = AsyncMock(return_value={"status": "dead"})
    mgr.close_tab = AsyncMock(return_value=(True, None))
    mgr.get_session_id.return_value = "replacement-session"
    mgr.get_live_url.return_value = "https://example.com/live"

    async def open_checked(_tab, url, **kwargs):
        await guard_browser_url(url)
        return {"url": url, "title": "", "warnings": []}

    mgr.open_tab = AsyncMock(side_effect=open_checked)
    mgr.screenshot = AsyncMock(return_value=b"png-test")
    mgr.get_current_url = AsyncMock(return_value=None)
    monkeypatch.setattr(BrowserManager, "get", lambda: mgr)
    monkeypatch.setattr(browser, "resolve_tab_key", lambda *_: "test-key")
    monkeypatch.setattr(browser, "_resolve_bf_key", AsyncMock(return_value=("test-key", "global")))
    return tab, mgr


def test_screenshot_recovers_chromium_error_page(client, db, workspace, dead_browser):
    tab, mgr = dead_browser
    response = client.get(f"/v1/browser/tabs/{tab.id}/screenshot",
                          headers={"X-Workspace-Token": workspace["token"]})
    assert response.status_code == 200
    assert response.content == b"png-test"
    mgr.open_tab.assert_awaited_once_with(tab.id, "about:blank", bb_context_id="saved-cookies", api_key="test-key")
    db.refresh(tab)
    assert tab.session_id == "replacement-session"
    assert tab.url == "about:blank"
    assert "previous page failed" in tab.last_error


@pytest.mark.parametrize("url", ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings/", "http://127.0.0.1/"])
def test_unsafe_saved_target_returns_400(client, db, workspace, dead_browser, url):
    tab, mgr = dead_browser
    tab.url = url
    db.commit()
    response = client.get(f"/v1/browser/tabs/{tab.id}/screenshot",
                          headers={"X-Workspace-Token": workspace["token"]})
    assert response.status_code == 400
    assert response.json()["data"]["error_code"]
    mgr.screenshot.assert_not_awaited()
    db.refresh(tab)
    assert tab.session_id == "dead-session"


@pytest.mark.asyncio
async def test_error_page_is_still_forbidden_as_explicit_navigation():
    with pytest.raises(UnsafeURLError):
        await guard_browser_url("chrome-error://chromewebdata/")


@pytest.mark.asyncio
async def test_idle_sse_flushes_200_before_waiting_for_events(monkeypatch):
    # No Redis message or idle tick is available. Exercise compression too:
    # it otherwise buffers response.start until the first body chunk.
    never = asyncio.Event()

    async def quiet_subscription(_):
        await never.wait()
        yield None

    monkeypatch.setattr(events.cache, "subscribe_events", quiet_subscription)
    monkeypatch.setattr(events, "_authorize_event_stream", lambda *_: (
        ("workspace", SimpleNamespace(kind="machine"), None, set()), None,
    ))
    scope = {"type": "http", "method": "GET", "path": "/v1/events/stream",
             "headers": [(b"accept-encoding", b"gzip")], "asgi": {"spec_version": "2.4"}}
    response = await events.stream_events(Request(scope), network="workspace", channel=None,
                                         token=None, access_token=None, x_workspace_token="test", authorization=None)
    messages = []
    first_chunk = asyncio.Event()

    async def send(message):
        messages.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            first_chunk.set()

    async def receive():
        await never.wait()

    task = asyncio.create_task(GZipMiddleware(response, minimum_size=1000)(scope, receive, send))
    try:
        await asyncio.wait_for(first_chunk.wait(), timeout=1)
        assert messages[0]["status"] == 200
        assert messages[1]["body"] == b": connected\n\n"
        assert not task.done()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
