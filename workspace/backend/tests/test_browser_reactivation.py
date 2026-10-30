"""Recovery must wake in place, never discard logins on provider failures."""
from unittest.mock import AsyncMock, MagicMock
import httpx
import pytest
from app.browser import BrowserManager, BrowserReactivationError
from app.models import BrowserTab
from app.routers import browser

@pytest.mark.asyncio
async def test_reactivate_same_session_refreshes_share():
    mgr = BrowserManager()
    mgr._sessions['tab'] = 'saved'
    mgr._bf_call = AsyncMock(side_effect=[{'result': {'title': 'Awake'}}, {'result': {'sessions': [
        {'session_id':'other','share_url':'other'}, {'session_id':'saved','share_url':'refreshed'}]}}])
    await mgr.reactivate_tab('tab')
    assert mgr.get_session_id('tab') == 'saved'
    assert mgr.get_live_url('tab') == 'refreshed'
    assert mgr._bf_call.await_args_list[0].args == ('get_page_info', {}, 'saved')
    assert [c.args[0] for c in mgr._bf_call.await_args_list] == ['get_page_info','list_sessions']

@pytest.mark.asyncio
async def test_provider_failure_keeps_session_and_link():
    mgr = BrowserManager()
    mgr._sessions['tab'] = 'saved'
    mgr._live_urls['tab'] = 'existing'
    response = httpx.Response(500, request=httpx.Request('POST','https://bf.test/call'))
    mgr._bf_call = AsyncMock(side_effect=httpx.HTTPStatusError('error', request=response.request,response=response))
    with pytest.raises(BrowserReactivationError) as error:
        await mgr.reactivate_tab('tab')
    assert error.value.code == 'WAKE_FAILED'
    assert isinstance(error.value.__cause__, httpx.HTTPStatusError)
    assert mgr.get_session_id('tab') == 'saved'
    assert mgr.get_live_url('tab') == 'existing'
    assert mgr._bf_call.await_count == 1

@pytest.fixture
def saved_tab(db, workspace, monkeypatch):
    tab = BrowserTab(workspace_id=workspace['id'],url='https://example.com',session_id='saved',
                     live_url='https://browserfabric.com/live/old',status='active',created_by='human:test')
    db.add(tab); db.commit()
    mgr = MagicMock()
    mgr.reconnect = AsyncMock()
    mgr.probe_session = AsyncMock(return_value={'status':'unknown'})
    mgr.reactivate_tab = AsyncMock(return_value={'title':'Awake'})
    mgr.get_live_url.return_value = 'https://browserfabric.com/live/new'
    monkeypatch.setattr(browser.BrowserManager,'get',lambda: mgr)
    monkeypatch.setattr(browser,'resolve_tab_key',lambda *_: 'test-key')
    return tab,mgr

@pytest.mark.parametrize('probe', [{'status':'unknown'},{'status':'alive','hibernated':True},{'status':'dead'}])
def test_polling_reports_status_without_replacing_session(client,db,workspace,saved_tab,probe):
    tab,mgr = saved_tab
    mgr.probe_session.return_value = probe
    response = client.get(f'/v1/browser/tabs/{tab.id}?validate=true',headers={'X-Workspace-Token':workspace['token']})
    assert response.status_code == 200
    assert response.json()['data']['connection_status'] == probe['status']
    assert response.json()['data']['asleep'] == bool(probe.get('hibernated'))
    assert db.get(BrowserTab,tab.id).session_id == 'saved'
    mgr.close_tab.assert_not_called()
    mgr.open_tab.assert_not_called()
    mgr.reactivate_tab.assert_not_awaited()

def test_reactivate_keeps_session_and_updates_link(client,db,workspace,saved_tab):
    tab,mgr = saved_tab
    response = client.post(f'/v1/browser/tabs/{tab.id}/reactivate',headers={'X-Workspace-Token':workspace['token']})
    assert response.status_code == 200, response.text
    assert response.json()['data']['live_url'].endswith('/new')
    assert db.get(BrowserTab,tab.id).session_id == 'saved'
    mgr.close_tab.assert_not_called()
    mgr.open_tab.assert_not_called()

def test_failed_reactivation_preserves_data_without_leaking_provider_error(client,db,workspace,saved_tab):
    tab,mgr = saved_tab
    mgr.reactivate_tab.side_effect = RuntimeError('secret provider diagnostic')
    response = client.post(f'/v1/browser/tabs/{tab.id}/reactivate',headers={'X-Workspace-Token':workspace['token']})
    assert response.status_code == 503
    assert response.headers['Retry-After'] == '2'
    assert 'has not been replaced' in response.text
    assert 'secret provider diagnostic' not in response.text
    assert db.get(BrowserTab,tab.id).live_url.endswith('/old')
    mgr.close_tab.assert_not_called()

@pytest.mark.asyncio
async def test_inaccessible_session_is_retryable_without_replacement():
    mgr = BrowserManager()
    mgr._sessions['tab'] = 'saved'
    mgr._live_urls['tab'] = 'existing'
    mgr._bf_call = AsyncMock(side_effect=RuntimeError(
        'Browser Fabric error: No active session. Create a session first.'))
    with pytest.raises(BrowserReactivationError) as error:
        await mgr.reactivate_tab('tab')
    assert error.value.code == 'SESSION_UNAVAILABLE'
    assert error.value.stage == 'wake'
    assert mgr.get_session_id('tab') == 'saved'
    assert mgr.get_live_url('tab') == 'existing'
    assert mgr._bf_call.await_count == 1

@pytest.mark.asyncio
async def test_awake_session_without_live_link_reports_separate_failure():
    mgr = BrowserManager()
    mgr._sessions['tab'] = 'saved'
    mgr._bf_call = AsyncMock(side_effect=[{'result': {'title': 'Awake'}},
                                          {'result': {'sessions': []}}])
    with pytest.raises(BrowserReactivationError) as error:
        await mgr.reactivate_tab('tab')
    assert error.value.code == 'LIVE_VIEW_UNAVAILABLE'
    assert error.value.stage == 'live_view'
    assert mgr.get_session_id('tab') == 'saved'

def test_safe_recovery_diagnostics(client, db, workspace, saved_tab, caplog):
    tab, mgr = saved_tab
    error = BrowserReactivationError('SESSION_UNAVAILABLE', 'wake')
    error.__cause__ = RuntimeError('private credential and provider payload')
    mgr.reactivate_tab.side_effect = error
    response = client.post(f'/v1/browser/tabs/{tab.id}/reactivate',
                           headers={'X-Workspace-Token':workspace['token']})
    assert response.status_code == 503
    assert response.json()['data'] == {'error_code':'SESSION_UNAVAILABLE','retryable':True}
    assert 'stage=wake code=SESSION_UNAVAILABLE exception=RuntimeError' in caplog.text
    assert 'private credential' not in caplog.text + response.text
    assert db.get(BrowserTab, tab.id).session_id == 'saved'
    mgr.close_tab.assert_not_called()
    mgr.open_tab.assert_not_called()

def test_reactivation_requires_access(client,saved_tab):
    tab,mgr = saved_tab
    response = client.post(f'/v1/browser/tabs/{tab.id}/reactivate')
    assert response.status_code == 401
    mgr.reactivate_tab.assert_not_awaited()
