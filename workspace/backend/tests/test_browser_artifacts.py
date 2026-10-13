"""Live browser cards stay attached to the right conversation."""
import asyncio
from unittest.mock import AsyncMock, MagicMock
import pytest
from sqlalchemy import select
from app.models import BrowserTab, Channel, EventRecord, Workspace
from app.routers import browser
from app.services.browser_preview import forget_tab_channel

@pytest.fixture
def setup(db, workspace, monkeypatch):
    ws = db.get(Workspace, workspace['id'])
    for name in ['browser-demo', 'other']:
        db.add(Channel(workspace_id=ws.id, name=name, title=name, status='active'))
    tab = BrowserTab(workspace_id=ws.id, created_by='openagents:agent-alpha', url='https://example.com', status='active')
    db.add(tab)
    db.commit()
    # Avoid external router/push work; the real event pipeline still persists
    # and routes the informational message.
    monkeypatch.setattr('app.config.config.ROUTER_LLM_ENABLED', False)
    return ws, tab

def cards(db, tab):
    return db.execute(select(EventRecord).where(EventRecord.network_id == tab.workspace_id, EventRecord.type == 'workspace.message.posted')).scalars().all()

def test_once_per_thread_and_survives_activity_expiry(db, setup):
    ws, tab = setup
    for action in ['open', 'click', 'navigate', 'evaluate']:
        asyncio.run(browser._record_browser_work(db, ws, tab, tab.created_by, 'browser-demo', action))
    rows = cards(db, tab)
    assert len(rows) == 1
    assert rows[0].target == 'channel/browser-demo'
    assert rows[0].payload['message_type'] == 'artifact'
    assert 'requester_email' not in rows[0].metadata_
    assert f'/v1/browser/tabs/{tab.id}' in rows[0].payload['content']
    assert rows[0].metadata_['target_agents'] == ['__no_response__']
    forget_tab_channel(tab.id)
    browser._local_activity.clear()
    asyncio.run(browser._record_browser_work(db, ws, tab, tab.created_by, None, 'snapshot'))
    assert len(cards(db, tab)) == 1
    assert browser._tab_to_dict(tab)['artifact_channels'] == ['browser-demo']
    asyncio.run(browser._record_browser_work(db, ws, tab, tab.created_by, 'other', 'click'))
    assert len(cards(db, tab)) == 2
    assert tab.artifact_channels == ['other', 'browser-demo']

@pytest.mark.parametrize('actor,channel', [('human:user','browser-demo'),('openagents:agent-alpha',None),('openagents:agent-alpha','missing')])
def test_never_guesses_a_channel(db, setup, actor, channel):
    ws,tab = setup
    asyncio.run(browser._record_browser_work(db,ws,tab,actor,channel,'click'))
    assert not cards(db,tab)
    assert tab.artifact_channels == []

@pytest.mark.parametrize('action,payload', [('navigate',{'url':'https://example.com'}), ('click',{'selector':'a'}), ('type',{'selector':'input','text':'hello'}), ('press_key',{'key':'Tab'}), ('evaluate',{'expression':'document.title'}), ('snapshot',None), ('screenshot',None)])
def test_operations_on_existing_tab_publish_preview(client, db, workspace, setup, monkeypatch, action, payload):
    ws,tab = setup
    manager = MagicMock()
    for method in ['navigate','click','type_text','press_key','evaluate']:
        setattr(manager, method, AsyncMock(return_value={'url':'https://example.com', 'result':'Example'}))
    manager.snapshot = AsyncMock(return_value='Example Domain')
    manager.screenshot = AsyncMock(return_value=b'png')
    manager.get_current_url = AsyncMock(return_value=None)
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: manager)
    monkeypatch.setattr(browser, '_ensure_connected', AsyncMock())
    args = {'source':'openagents:agent-alpha','channel':'browser-demo'}
    headers = {'X-Workspace-Token': workspace['token']}
    url = f'/v1/browser/tabs/{tab.id}/{action}'
    response = client.get(url,params=args,headers=headers) if payload is None else client.post(url,json={**args,**payload},headers=headers)
    assert response.status_code == 200, response.text
    db.expire_all()
    assert len(cards(db,tab)) == 1
    assert tab.artifact_channels == ['browser-demo']

def test_rejected_card_can_be_retried(db, setup, monkeypatch):
    ws,tab=setup
    monkeypatch.setattr(browser, '_emit_event', AsyncMock(return_value=None))
    asyncio.run(browser._record_browser_work(db,ws,tab,tab.created_by,'browser-demo','click'))
    db.refresh(tab)
    assert tab.artifact_channels == []
