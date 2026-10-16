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


def test_closed_artifact_metadata_requires_access_and_does_not_reopen(client, db, workspace, setup, monkeypatch):
    ws, tab = setup
    tab.status = 'closed'
    tab.title = 'Saved browser'
    db.commit()
    connect = AsyncMock()
    monkeypatch.setattr(browser, '_ensure_connected', connect)
    url = f'/v1/browser/tabs/{tab.id}'
    headers = {'X-Workspace-Token': workspace['token']}
    assert client.get(url, headers=headers).status_code == 404
    assert client.get(url+'?include_closed=true').status_code == 401
    response = client.get(url+'?include_closed=true&validate=true', headers=headers)
    assert response.status_code == 200
    assert response.json()['data']['status'] == 'closed'
    assert response.json()['data']['title'] == 'Saved browser'
    connect.assert_not_called()


@pytest.mark.parametrize('fails', [False, True])
def test_reopen_preserves_browser_artifact_identity(client, db, workspace, setup, monkeypatch, fails):
    from app.models import BrowserUsage
    ws, tab = setup
    tab.status = 'closed'
    tab.session_id = None
    tab.artifact_channels = ['browser-demo']
    db.commit()
    manager = MagicMock()
    manager.open_tab = AsyncMock(side_effect=RuntimeError('offline')) if fails else AsyncMock(return_value={'title':'Example Domain','url':tab.url})
    manager.get_session_id.return_value = None
    manager.get_live_url.return_value = None
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: manager)
    monkeypatch.setattr(browser, '_resolve_bf_key', AsyncMock(return_value=(None, None)))
    headers = {'X-Workspace-Token': workspace['token']}
    url = f'/v1/browser/tabs/{tab.id}/reconnect'
    assert client.post(url, headers=headers).status_code == 404
    assert client.post(url+'?reopen=true').status_code == 401
    manager.open_tab.assert_not_called()
    response = client.post(url+'?reopen=true', headers=headers)
    assert response.status_code == (500 if fails else 200)
    db.refresh(tab)
    assert tab.status == ('closed' if fails else 'active')
    assert tab.artifact_channels == ['browser-demo']
    assert tab.created_by == 'openagents:agent-alpha'
    usage = db.execute(select(BrowserUsage).where(BrowserUsage.tab_id == tab.id)).scalars().all()
    assert len(usage) == (0 if fails else 1)
    if not fails:
        assert response.json()['data']['id'] == tab.id
    manager.open_tab.assert_awaited_once()


@pytest.mark.parametrize("channel", [
    "dm:human:test@example.com",
    "dm:human:test@example.com,openagents:agent-alpha",
    "dm:openagents:agent-alpha,human:test@example.com",
])
def test_dm_browser_records_canonical_pair_and_direct_card(db, setup, channel):
    ws, tab = setup
    db.add(EventRecord(id="dm-request", network_id=ws.id, type="workspace.message.posted",
        source="human:test@example.com", target=tab.created_by,
        payload={"content": "Use the browser"}, timestamp=1))
    db.commit()
    for action in ["open", "snapshot"]:
        asyncio.run(browser._record_browser_work(db, ws, tab, tab.created_by, channel, action))
    assert tab.artifact_channels == ["dm:human:test@example.com,openagents:agent-alpha"]
    previews = [row for row in cards(db, tab) if row.id != "dm-request"]
    assert len(previews) == 1
    assert previews[0].target == "human:test@example.com"
    assert previews[0].metadata_["target_agents"] == ["__no_response__"]


@pytest.mark.parametrize("channel", [
    "dm:human:stranger@example.com",
    "dm:human:test@example.com,openagents:other-agent",
    "dm:human:test@example.com,openagents:agent-alpha,human:third@example.com",
    "dm:channel/private-thread",
])
def test_dm_browser_does_not_guess_or_announce_into_unrelated_conversations(db, setup, channel):
    ws, tab = setup
    asyncio.run(browser._record_browser_work(db, ws, tab, tab.created_by, channel, "open"))
    assert tab.artifact_channels == []
    assert not cards(db, tab)
