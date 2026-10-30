"""Agent control events must never become human-facing conversations."""
from uuid import uuid4
import json
import re
import pytest
from sqlalchemy import event
from app.models import DirectThreadLink, EventRecord
from tests.test_people_messaging import people, quiet_side_effects, _as, _tok  # noqa: F401


def seed(db, workspace, source, target, timestamp, event_type='workspace.message.posted', content='hello'):
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source=source,
                       target=target, timestamp=timestamp, type=event_type,
                       visibility='direct', payload={'content':content}))


def test_controls_do_not_create_conversations_or_replace_previews(client, db, workspace, people):
    # A control-only pair would previously become an empty "system:" thread.
    seed(db, workspace, 'human:system', 'openagents:private-agent', 300, 'workspace.agent.control')
    seed(db, workspace, 'human:adam@acme.test', 'openagents:mine', 100)
    # Same timestamp tests that the latest-event lookup applies the same filter.
    seed(db, workspace, 'human:adam@acme.test', 'openagents:mine', 100, 'workspace.agent.control', 'not a preview')
    seed(db, workspace, 'human:adam@acme.test', 'openagents:mine', 200, 'workspace.agent.control')
    seed(db, workspace, 'human:system', 'openagents:system-agent', 400)
    seed(db, workspace, 'human:mia@acme.test', 'openagents:private-agent', 500, content='private chat')
    db.commit()
    url=f"/v1/events/conversations?network={workspace['id']}"
    result=client.get(url,headers=_as('adam',workspace)).json()['data']['conversations']
    assert len(result)==1
    assert result[0]['agents']==['human:adam@acme.test','openagents:mine']
    assert result[0]['message_count']==1
    assert result[0]['last_message']['content']=='hello'
    assert result[0]['last_message']['timestamp']==100
    # The other owner's real conversation remains visible only to them.
    result=client.get(url,headers=_as('mia',workspace)).json()['data']['conversations']
    assert len(result)==1
    assert result[0]['last_message']['content']=='private chat'
    machine=client.get(url,headers=_tok(workspace)).json()['data']['conversations']
    assert len(machine)==2


def test_old_system_thread_links_no_longer_open_as_chats(client, db, workspace, people):
    session='dm:human:system,openagents:private-agent'
    link=DirectThreadLink(workspace_id=workspace['id'],session_key=session)
    db.add(link); db.commit()
    response=client.get(f"/v1/thread-links/{link.id}?network={workspace['id']}",headers=_as('adam',workspace))
    assert response.status_code==404
    response=client.post('/v1/thread-links',headers=_as('adam',workspace),json={'network':workspace['id'],'session_id':session})
    assert response.status_code==404


@pytest.mark.parametrize('pair_count', [1, 10, 100])
def test_conversation_event_queries_are_batched(client, db, workspace, people, monkeypatch, pair_count):
    monkeypatch.setattr('app.routers.events.unread_cutoff_ms', lambda: 0)
    me = 'human:adam@acme.test'
    markers = {}
    for i in range(pair_count):
        agent = f'openagents:batch-{i:02}'
        seed(db, workspace, me, agent, 100)
        seed(db, workspace, agent, me, 200 + i)
        markers[f'dm:{me},{agent}'] = 100
    db.commit()
    queries = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT') and re.search(r'\bFROM events\b', statement):
            queries.append(statement)

    engine = db.get_bind()
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/v1/events/conversations', headers=_as('adam', workspace),
                              params={'network': workspace['id'], 'read_at': json.dumps(markers), 'limit': pair_count})
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    assert response.status_code == 200
    conversations = response.json()['data']['conversations']
    assert len(conversations) == pair_count
    assert all(row['message_count'] == 2 and row['unread_count'] == 1 for row in conversations)
    assert len(queries) == 3, 'One aggregate, one preview batch and one unread batch'
