"""Saved-only cloud tabs, including legacy client requests."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models import BrowserContext, BrowserTab
from app.routers import browser


@pytest.fixture
def manager(monkeypatch):
    value = MagicMock()
    value.is_cloud_for.return_value = True
    value.get_session_id.return_value = 'saved-session'
    value.get_live_url.return_value = 'https://browserfabric.com/live/saved'
    value.open_tab = AsyncMock(return_value={'url': 'https://example.com', 'title': 'Example'})
    value.create_bb_context = AsyncMock(return_value='bf-saved-context')
    value.close_tab = AsyncMock(return_value=(True, None))
    value.reconnect = AsyncMock()
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: value)
    monkeypatch.setattr(browser, '_resolve_bf_key', AsyncMock(return_value=('test-key', 'global')))
    return value


@pytest.mark.parametrize('extra', [{}, {'persistent': False}, {'persistent': True}])
def test_every_new_cloud_tab_has_a_confirmed_saved_context(client, db, workspace, manager, extra):
    result = client.post('/v1/browser/tabs', headers={'X-Workspace-Token': workspace['token']}, json={
        'network': workspace['id'], 'url': 'https://example.com', **extra,
    })
    assert result.status_code == 200, result.json()
    data = result.json()['data']
    assert data['persistent'] is True
    assert manager.open_tab.await_args.kwargs['persist'] is True
    context = db.get(BrowserContext, data['context_id'])
    assert context.bb_context_id == 'bf-saved-context'
    assert db.get(BrowserTab, data['id']).context_id == context.id


def test_save_failure_keeps_tab_tracked_without_inventing_a_saved_context(client, db, workspace, manager):
    manager.create_bb_context.side_effect = RuntimeError('save failed')
    result = client.post('/v1/browser/tabs', headers={'X-Workspace-Token': workspace['token']}, json={
        'network': workspace['id'], 'url': 'https://example.com',
    })
    data = result.json()['data']
    assert 'context_id' not in data
    assert any('context_save_failed' in warning for warning in data['warnings'])
    assert db.get(BrowserTab, data['id']).session_id == 'saved-session'
    assert db.query(BrowserContext).count() == 0


def test_legacy_unpersist_cannot_delete_cloud_login_state(client, db, workspace, manager):
    headers = {'X-Workspace-Token': workspace['token']}
    data = client.post('/v1/browser/tabs', headers=headers, json={'network':workspace['id']}).json()['data']
    result = client.post(f"/v1/browser/tabs/{data['id']}/unpersist", headers=headers)
    assert result.status_code == 400
    assert db.get(BrowserContext, data['context_id']).status == 'active'
    manager.delete_bb_context.assert_not_called()


def test_reconnect_reuses_saved_login_and_stable_tab_id(client, db, workspace, manager):
    headers = {'X-Workspace-Token': workspace['token']}
    original = client.post('/v1/browser/tabs', headers=headers, json={'network': workspace['id']}).json()['data']
    manager.open_tab.reset_mock()
    manager.get_session_id.return_value = 'resumed-session'
    response = client.post(f"/v1/browser/tabs/{original['id']}/reconnect?confirm_replace=true&expected_session_id=saved-session", headers=headers)
    assert response.status_code == 200, response.json()
    assert response.json()['data']['id'] == original['id']
    assert response.json()['data']['context_id'] == original['context_id']
    assert manager.open_tab.await_args.kwargs['bb_context_id'] == 'bf-saved-context'
    assert db.query(BrowserContext).count() == 1


def test_legacy_reconnect_save_failure_does_not_close_current_session(client, db, workspace, manager):
    headers = {'X-Workspace-Token': workspace['token']}
    original = client.post('/v1/browser/tabs', headers=headers, json={'network': workspace['id']}).json()['data']
    tab = db.get(BrowserTab, original['id'])
    tab.context_id = None
    db.commit()
    manager.create_bb_context.side_effect = RuntimeError('unavailable')
    manager.close_tab.reset_mock()
    response = client.post(f"/v1/browser/tabs/{tab.id}/reconnect?confirm_replace=true&expected_session_id=saved-session", headers=headers)
    assert response.status_code == 400
    manager.close_tab.assert_not_awaited()
    assert db.get(BrowserTab, tab.id).session_id == 'saved-session'


@pytest.mark.asyncio
async def test_manager_ignores_legacy_persist_false(monkeypatch):
    from app.browser import BrowserManager
    monkeypatch.setattr('app.browser.BROWSERFABRIC_API_KEY', 'test-key')
    value = BrowserManager()
    value._bf_call = AsyncMock(return_value={'result': {'session_id': 'saved', 'url': 'about:blank'}})
    await value.open_tab('tab', 'about:blank', persist=False)
    create = value._bf_call.await_args_list[0]
    assert create.args[0] == 'create_session'
    assert create.args[1]['persist'] is True


@pytest.mark.asyncio
async def test_manager_requires_real_saved_context_id(monkeypatch):
    from app.browser import BrowserManager
    monkeypatch.setattr('app.browser.BROWSERFABRIC_API_KEY', 'test-key')
    value = BrowserManager()
    value._bf_call = AsyncMock(return_value={'result': {}})
    with pytest.raises(RuntimeError, match='did not confirm'):
        await value.create_bb_context(session_id='saved')


@pytest.mark.asyncio
async def test_sleeping_cloud_tabs_do_not_consume_local_tab_limit(monkeypatch):
    from app.browser import BrowserManager
    monkeypatch.setattr('app.browser.BROWSERFABRIC_API_KEY', 'test-key')
    monkeypatch.setattr('app.browser.MAX_BROWSER_TABS', 1)
    value = BrowserManager()
    value._sessions['sleeping-tab'] = 'sleeping-session'
    value._bf_call = AsyncMock(return_value={'result': {'session_id': 'new', 'url': 'about:blank'}})
    await value.open_tab('new-tab', 'about:blank')
    assert value.get_session_id('sleeping-tab') == 'sleeping-session'
    assert value.get_session_id('new-tab') == 'new'
