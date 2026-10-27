"""Regression coverage for the 2026-10-27 stale-worker replacement loop."""
import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import update

from app.browser import BrowserManager
from app.models import BrowserTab, Workspace
from app.routers import browser
from tests.conftest import TestingSessionLocal


@pytest.fixture
def saved_tab(db, workspace):
    ws = db.get(Workspace, workspace['id'])
    ws.settings = {'browserfabric_api_key': 'test-only-key'}
    tab = BrowserTab(workspace_id=ws.id, created_by='human:user',
                     session_id='current-session', live_url='current-link',
                     url='https://example.com/editor', status='active')
    db.add(tab)
    db.commit()
    return tab, ws


def worker(monkeypatch, tab):
    manager = BrowserManager()
    manager._sessions[tab.id] = 'old-closed-session'
    manager._live_urls[tab.id] = 'old-link'
    manager._bf_call = AsyncMock(return_value={'result': {'url': tab.url, 'title': 'Editor'}})
    manager.open_tab = AsyncMock()
    manager.close_tab = AsyncMock()
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: manager)
    return manager


@pytest.mark.asyncio
async def test_stale_worker_probes_database_session_and_discards_old_link(db, saved_tab, monkeypatch):
    tab, ws = saved_tab
    manager = worker(monkeypatch, tab)
    # A second worker changes the DB while this ORM instance is still stale.
    with TestingSessionLocal() as other:
        other.execute(update(BrowserTab).where(BrowserTab.id == tab.id)
                      .values(session_id='newest-session', live_url='newest-link'))
        other.commit()
    await browser._ensure_connected(tab, db, ws)
    assert manager._bf_call.await_args.args[2] == 'newest-session'
    assert manager.get_session_id(tab.id) == 'newest-session'
    assert manager.get_live_url(tab.id) is None
    manager.close_tab.assert_not_awaited()
    manager.open_tab.assert_not_awaited()


@pytest.mark.asyncio
async def test_same_session_reconnect_keeps_its_live_link():
    manager = BrowserManager()
    manager._sessions['tab'] = 'session'
    manager._live_urls['tab'] = 'link'
    await manager.reconnect('tab', 'session', api_key='test-key')
    assert manager.get_live_url('tab') == 'link'


@pytest.mark.asyncio
async def test_close_uses_explicit_identity_without_destroying_newer_cache():
    manager = BrowserManager()
    manager._sessions['tab'] = 'newer-session'
    manager._live_urls['tab'] = 'newer-link'
    manager._bf_call = AsyncMock(return_value={'success': True})
    await manager.close_tab('tab', session_id_hint='explicit-old-session', api_key='test-key')
    assert manager._bf_call.await_args.args[2] == 'explicit-old-session'
    assert manager.get_session_id('tab') == 'newer-session'
    assert manager.get_live_url('tab') == 'newer-link'


@pytest.mark.parametrize('error', [
    RuntimeError('No active session. Create a session first.'),
    RuntimeError('Element not found'),
    httpx.ReadTimeout('provider timeout'),
])
@pytest.mark.parametrize('operation', ['evaluate', 'screenshot', 'snapshot', 'navigate'])
def test_failed_actions_and_reads_keep_editor_session(client, db, workspace, saved_tab, monkeypatch, error, operation):
    tab, _ = saved_tab
    manager = worker(monkeypatch, tab)
    manager._bf_call.side_effect = error
    url = f'/v1/browser/tabs/{tab.id}/{operation}'
    headers = {'X-Workspace-Token': workspace['token']}
    if operation in ('snapshot', 'screenshot'):
        result = client.get(url, headers=headers)
    else:
        body = {'expression': 'window.marker'} if operation == 'evaluate' else {'url': 'https://example.com'}
        result = client.post(url, headers=headers, json=body)
    assert result.status_code == 503, result.text
    assert result.headers['retry-after'] == '2'
    assert 'not been replaced' in result.json()['detail']
    db.refresh(tab)
    assert tab.session_id == 'current-session'
    assert tab.live_url == 'current-link'
    manager.open_tab.assert_not_awaited()
    manager.close_tab.assert_not_awaited()


@pytest.mark.asyncio
async def test_simultaneous_recovery_attempts_never_close_or_create(db, saved_tab, monkeypatch):
    tab, ws = saved_tab
    manager = worker(monkeypatch, tab)
    entered = 0
    both = asyncio.Event()

    async def unavailable(*args, **kwargs):
        nonlocal entered
        entered += 1
        if entered == 2:
            both.set()
        await asyncio.wait_for(both.wait(), 2)
        raise RuntimeError('No active session. Create a session first.')

    manager._bf_call.side_effect = unavailable
    with TestingSessionLocal() as other:
        second_tab = other.get(BrowserTab, tab.id)
        outcomes = await asyncio.gather(browser._ensure_connected(tab, db, ws),
                                        browser._ensure_connected(second_tab, other, ws),
                                        return_exceptions=True)
    assert all(isinstance(result, HTTPException) and result.status_code == 503 for result in outcomes)
    assert entered == 2
    manager.open_tab.assert_not_awaited()
    manager.close_tab.assert_not_awaited()
    db.refresh(tab)
    assert tab.session_id == 'current-session'


def test_replacement_requires_confirmation_and_current_identity(client, workspace, saved_tab, monkeypatch):
    tab, _ = saved_tab
    manager = worker(monkeypatch, tab)
    headers = {'X-Workspace-Token': workspace['token']}
    url = f'/v1/browser/tabs/{tab.id}/reconnect'
    denied = client.post(url, headers=headers)
    assert denied.status_code == 400
    assert 'unsaved' in denied.text
    stale = client.post(url, headers=headers, params={'confirm_replace': True, 'expected_session_id': 'old-closed-session'})
    assert stale.status_code == 409
    manager.close_tab.assert_not_awaited()
    manager.open_tab.assert_not_awaited()


def test_mapping_cas_cannot_overwrite_a_newer_session(db, saved_tab):
    tab, _ = saved_tab
    with pytest.raises(HTTPException) as exc:
        browser._replace_session_mapping(db, tab, 'old-closed-session', 'active', 'unwanted', 'unwanted-link')
    assert exc.value.status_code == 409
    db.refresh(tab)
    assert tab.session_id == 'current-session'
    assert tab.live_url == 'current-link'


def test_saving_context_does_not_restart_editor(client, workspace, saved_tab, monkeypatch):
    tab, _ = saved_tab
    manager = worker(monkeypatch, tab)
    manager.create_bb_context = AsyncMock(return_value='saved-context')
    result = client.post(f'/v1/browser/tabs/{tab.id}/persist',
                         headers={'X-Workspace-Token': workspace['token']},
                         json={'name': 'Editor login'})
    assert result.status_code == 200, result.text
    assert result.json()['data']['tab']['session_id'] == 'current-session'
    manager.create_bb_context.assert_awaited_once_with(session_id='current-session', tab_id=tab.id)
    manager.open_tab.assert_not_awaited()
    manager.close_tab.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_mapping_cannot_call_provider_default_session():
    manager = BrowserManager()
    manager._bf_call = AsyncMock()
    with pytest.raises(KeyError):
        await manager.reconnect('tab', None, api_key='test-key')
    manager._bf_call.assert_not_awaited()
