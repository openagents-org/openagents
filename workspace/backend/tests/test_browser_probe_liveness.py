# -*- coding: utf-8 -*-
"""Tests for BrowserManager.probe_session liveness classification.

The probe must only report "dead" when Browser Fabric definitively says the
session is gone. Transient transport errors (timeout / 5xx) must classify as
"unknown" so a slow get_page_info on a heavy SPA cannot tear down a healthy,
logged-in tab (the 2026-09-29 Lark incident).
"""

import asyncio
from unittest.mock import AsyncMock

import httpx

from app.browser import BrowserManager

TAB = "tab-xyz"
SID = "sess-123"


def _cloud_manager():
    mgr = BrowserManager()          # fresh instance, not the singleton
    mgr._sessions[TAB] = SID        # makes TAB a cloud tab
    return mgr


def _http_error(code):
    resp = httpx.Response(code, request=httpx.Request("POST", "http://bf/call"))
    return httpx.HTTPStatusError("boom", request=resp.request, response=resp)


def test_probe_alive():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(return_value={"result": {"url": "https://x/y", "title": "Y"}})
    out = asyncio.run(mgr.probe_session(TAB))
    assert out["status"] == "alive"
    assert out["url"] == "https://x/y"
    assert out["title"] == "Y"


def test_probe_dead_on_no_active_session():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(side_effect=RuntimeError("Browser Fabric error: No active session for id"))
    assert asyncio.run(mgr.probe_session(TAB))["status"] == "dead"


def test_probe_unknown_on_other_app_error():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(side_effect=RuntimeError("Browser Fabric error: navigation in progress"))
    assert asyncio.run(mgr.probe_session(TAB))["status"] == "unknown"


def test_probe_unknown_on_timeout():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(side_effect=httpx.TimeoutException("read timeout"))
    assert asyncio.run(mgr.probe_session(TAB))["status"] == "unknown"


def test_probe_unknown_on_5xx():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(side_effect=_http_error(503))
    assert asyncio.run(mgr.probe_session(TAB))["status"] == "unknown"


def test_probe_dead_on_404():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(side_effect=_http_error(404))
    assert asyncio.run(mgr.probe_session(TAB))["status"] == "dead"


def test_probe_dead_when_no_session_mapping():
    mgr = BrowserManager()          # no session, no page -> not cloud, no local page
    assert asyncio.run(mgr.probe_session("unknown-tab"))["status"] == "dead"


# ---------------------------------------------------------------------------
# Polling paths must send probe=True (BF: no activity touch, no wake of a
# hibernated tab) and pass the hibernated flag through.
# ---------------------------------------------------------------------------
def test_probe_sends_probe_flag_and_reports_hibernated():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(return_value={"result": {"url": "https://x/y", "title": "Y", "hibernated": True}})
    out = asyncio.run(mgr.probe_session(TAB))
    assert out["status"] == "alive" and out["hibernated"] is True
    _, kwargs_or_args = mgr._bf_call.call_args[0][0], mgr._bf_call.call_args
    assert mgr._bf_call.call_args[0][0] == "get_page_info"
    assert mgr._bf_call.call_args[0][1] == {"probe": True}


def test_get_current_url_sends_probe_flag():
    mgr = _cloud_manager()
    mgr._bf_call = AsyncMock(return_value={"result": {"url": "https://x/y", "title": "Y"}})
    out = asyncio.run(mgr.get_current_url(TAB))
    assert out == {"url": "https://x/y", "title": "Y", "hibernated": False}
    assert mgr._bf_call.call_args[0][1] == {"probe": True}
