"""Human control requires identity, expires, and blocks agent mutations."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from app.models import BrowserTab
from app.routers import browser
from app.browser import BrowserManager

@pytest.fixture
def controlled(client, db, workspace, monkeypatch):
    tab = BrowserTab(workspace_id=workspace['id'], created_by='openagents:agent-alpha', url='https://example.com', status='active')
    db.add(tab); db.commit()
    verify = browser._verify_workspace_access
    monkeypatch.setattr(browser, '_verify_workspace_access', lambda ws, token, auth: verify(ws, token, None))
    monkeypatch.setattr(browser, 'resolve_current_user', lambda db, auth: SimpleNamespace(id=auth[7:]) if auth and auth.startswith('Bearer human') else None)
    manager = MagicMock()
    manager.human_input = AsyncMock(return_value={'url': 'https://example.com/next', 'title': 'Next'})
    manager.navigate = AsyncMock(return_value={'url': 'https://example.com', 'title': 'Example'})
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: manager)
    monkeypatch.setattr(browser, '_ensure_connected', AsyncMock())
    headers = {'X-Workspace-Token': workspace['token'], 'Authorization': 'Bearer human-one'}
    return tab, manager, headers, str(uuid4()), f'/v1/browser/tabs/{tab.id}'

def control(client, setup, action='claim', **kw):
    tab, manager, headers, token, base = setup
    return client.post(base+'/control', headers=kw.get('headers', headers), json={'token': kw.get('token', token), 'action': action})

def test_claim_requires_user_and_workspace_access(client, controlled):
    headers = controlled[2]
    assert control(client, controlled, headers={}).status_code == 401
    assert control(client, controlled, headers={'X-Workspace-Token':headers['X-Workspace-Token']}).status_code == 401
    assert control(client, controlled).status_code == 200

@pytest.mark.parametrize('action,payload', [
    ('navigate', {'url':'https://example.com'}), ('click', {'selector':'a'}),
    ('type', {'selector':'input','text':'hi'}), ('press_key', {'key':'Enter'}),
    ('evaluate', {'expression':'document.title'}), ('reconnect', {}),
    ('persist', {'name':'Example'}), ('unpersist', {}), ('close', {})])
def test_lease_blocks_agent_even_with_spoofed_source(client, controlled, action, payload):
    _, manager, headers, token, base = controlled
    assert control(client, controlled).status_code == 200
    machine = {'X-Workspace-Token':headers['X-Workspace-Token']}
    response = client.delete(base, headers=machine) if action == 'close' else client.post(base+'/'+action, headers=machine, json={**payload,'source':'human:user'})
    assert response.status_code == 409
    manager.navigate.assert_not_called()

def test_other_viewers_and_other_windows_cannot_steal_or_release(client, controlled):
    assert control(client, controlled).status_code == 200
    assert control(client, controlled, token=str(uuid4())).status_code == 409
    headers = {**controlled[2], 'Authorization':'Bearer human-two'}
    assert control(client, controlled, headers=headers).status_code == 409
    assert control(client, controlled, 'release', headers=headers).status_code == 409
    assert control(client, controlled, 'renew').status_code == 200
    assert control(client, controlled, 'release').status_code == 200
    assert control(client, controlled, headers=headers).status_code == 200

def test_input_requires_matching_active_lease(client, controlled, db):
    tab, manager, headers, token, base = controlled
    payload = {'token':token,'kind':'click','x':0.5,'y':0.25}
    assert client.post(base+'/input', headers=headers, json=payload).status_code == 409
    assert control(client, controlled).status_code == 200
    assert client.post(base+'/input', headers=headers, json={**payload,'token':str(uuid4())}).status_code == 409
    assert client.post(base+'/input', headers=headers, json={**payload,'x':2}).status_code == 422
    assert client.post(base+'/input', headers=headers, json=payload).status_code == 200
    manager.human_input.assert_awaited_once()
    db.refresh(tab)
    assert tab.title == 'Next'
    tab.control_expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
    db.commit()
    assert client.post(base+'/input', headers=headers, json=payload).status_code == 409
    assert control(client, controlled, 'renew').status_code == 409
    assert control(client, controlled, headers={**headers,'Authorization':'Bearer human-two'}).status_code == 200

def test_hand_back_restores_agent_navigation(client, controlled):
    _, manager, headers, _, base = controlled
    assert control(client, controlled).status_code == 200
    assert control(client, controlled, 'release').status_code == 200
    result = client.post(base+'/navigate',headers={'X-Workspace-Token':headers['X-Workspace-Token']},json={'url':'https://example.com'})
    assert result.status_code == 200
    manager.navigate.assert_awaited_once()

def test_scaled_screenshot_input_targets_same_page():
    manager = BrowserManager()
    page = MagicMock()
    page.viewport_size = {'width':1280,'height':720}
    page.url = 'https://example.com'
    page.title = AsyncMock(return_value='Example')
    page.mouse.click = AsyncMock(); page.mouse.wheel = AsyncMock()
    page.keyboard.insert_text = AsyncMock(); page.keyboard.press = AsyncMock()
    manager._pages['tab'] = page
    async def run():
        await manager.human_input('tab',{'kind':'click','x':0.5,'y':0.25})
        await manager.human_input('tab',{'kind':'text','text':'你好'})
        await manager.human_input('tab',{'kind':'key','key':'Enter'})
        await manager.human_input('tab',{'kind':'scroll','delta_x':0,'delta_y':500})
    asyncio.run(run())
    page.mouse.click.assert_awaited_once_with(640,180)
    page.keyboard.insert_text.assert_awaited_once_with('你好')
    page.keyboard.press.assert_awaited_once_with('Enter')
    page.mouse.wheel.assert_awaited_once_with(0,500)
