"""DM query semantics on SQLite and read-only PostgreSQL VALUES data."""
import os

import pytest
from sqlalchemy import bindparam, cast, create_engine, select, text, union_all
from sqlalchemy.sql.util import ClauseAdapter

from app.models import EventRecord
from app.routers.events import _dm_privacy_clause
from app.services.conversation_queries import conversation_pairs_query, conversation_detail_queries

WID = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
ME = 'human:me@example.test'
BOT = 'openagents:bot'


@pytest.fixture(params=['sqlite', 'postgresql'])
def query_db(request, db):
    if request.param == 'sqlite':
        yield db, False
        return
    url = os.getenv('TEST_DATABASE_URL', '')
    if not url.startswith('postgresql'):
        pytest.skip('requires TEST_DATABASE_URL for read-only synthetic PostgreSQL tests')
    engine = create_engine(url)
    with engine.connect() as conn:
        conn.execute(text('SET TRANSACTION READ ONLY'))
        conn.execute(text("SET LOCAL statement_timeout='5s'"))
        yield conn, True
        conn.rollback()
    engine.dispose()


def message(id, timestamp=100, source=ME, target=BOT, **kw):
    return dict(id=id, network_id=WID, type='workspace.message.posted', source=source,
                target=target, timestamp=timestamp, visibility='direct', payload={'content': id}) | kw


def summaries(query_db, rows, markers=None, mine=(ME,), agent=None, limit=20):
    conn, postgres = query_db
    columns = [c for c in EventRecord.__table__.c if c.name in rows[0]]
    def value(i, c, row):
        param = bindparam(f'r{i}_{c.name}', row[c.name], type_=c.type)
        return (cast(param, c.type) if postgres else param).label(c.name)
    values = [select(*(value(i, c, row) for c in columns)) for i, row in enumerate(rows)]
    events = (union_all(*values) if len(values) > 1 else values[0]).cte('fixture_events')
    filters = [] if mine is None else [ClauseAdapter(events, adapt_on_names=True).traverse(_dm_privacy_clause(list(mine)))]
    pairs = conn.execute(conversation_pairs_query(WID, limit, agent, filters, events=events)).all()
    latest, unread = conversation_detail_queries(WID, pairs, markers or {}, list(mine or []) + ['human:user'], 100, events=events)
    previews = {(r.agent_a, r.agent_b): dict(r._mapping) for r in conn.execute(latest)} if latest is not None else {}
    counts = {(r.agent_a, r.agent_b): r.unread_count for r in conn.execute(unread)} if unread is not None else {}
    return pairs, previews, counts


def test_bidirectional_counts_old_history_and_latest_ties(query_db):
    rows = [message('old', 1), message('middle', 101, source=BOT, target=ME),
            message('tie-a', 200), message('tie-z', 200, source=BOT, target=ME),
            message('control', 999, type='workspace.agent.control'),
            message('channel', 999, target='channel/secret'),
            message('nondirect', 999, visibility='channel'),
            message('foreign', 999, network_id=OTHER),
            message('system', 999, source='HUMAN:SYSTEM'),
            message('system-target', 999, target='human:system')]
    pairs, previews, _ = summaries(query_db, rows)
    assert len(pairs) == 1
    assert (pairs[0].agent_a, pairs[0].agent_b, pairs[0].msg_count, pairs[0].last_ts) == (ME, BOT, 4, 200)
    assert previews[(ME, BOT)]['payload']['content'] == 'tie-z'
    assert previews[(ME, BOT)]['source'] == BOT


@pytest.mark.parametrize('mine,expected', [
    ((ME,), {'mine', 'legacy', 'agents'}),
    ((), {'legacy', 'agents'}),
    (None, {'mine', 'private', 'legacy', 'agents'}),
    (('openagents:owned', 'human:owner@example.test'), {'private', 'legacy', 'agents'}),
])
def test_identity_scope_applies_before_limit(query_db, mine, expected):
    rows = [message('mine'), message('private', 300, source='human:owner@example.test', target='openagents:owned'),
            message('legacy', 200, source='human:user'), message('agents', 150, source='openagents:a')]
    pairs, previews, _ = summaries(query_db, rows, mine=mine)
    assert {p['payload']['content'] for p in previews.values()} == expected
    pairs, previews, _ = summaries(query_db, rows, mine=mine, limit=1)
    expected_latest = 'private' if 'private' in expected else 'legacy'
    assert len(pairs) == 1 and next(iter(previews.values()))['payload']['content'] == expected_latest


def test_unread_exact_markers_cutoff_direction_and_message_types(query_db):
    rows = [message('before-cutoff', 99, BOT, ME), message('at-cutoff', 100, BOT, ME),
            message('at-marker', 101, BOT, ME), message('incoming', 102, BOT, ME),
            message('outgoing', 103), message('thinking', 104, BOT, ME, payload={'message_type': 'thinking'}),
            message('status', 105, BOT, ME, payload={'message_type': 'status'}),
            message('todos', 106, BOT, ME, payload={'message_type': 'todos'}),
            message('null-type', 107, BOT, ME, payload={'message_type': None}),
            message('second', 108, 'openagents:second', ME)]
    markers = {f'dm:{ME},{BOT}': 101, f'dm:{ME},openagents:second': 108}
    pairs, previews, counts = summaries(query_db, rows, markers)
    assert counts.get((ME, BOT)) == 2
    assert counts.get((ME, 'openagents:second'), 0) == 0
    assert previews[(ME, BOT)]['timestamp'] == 107
    _, _, cutoff_counts = summaries(query_db, rows, {f'dm:{ME},{BOT}': 0})
    assert cutoff_counts[(ME, BOT)] == 4
    assert summaries(query_db, rows)[2] == {}


def test_agent_filter_self_pairs_and_empty_result(query_db):
    rows = [message('out'), message('in', 200, BOT, ME),
            message('other', 300, ME, 'openagents:other'), message('self', 400, BOT, BOT)]
    pairs, previews, _ = summaries(query_db, rows, agent=BOT)
    assert len(pairs) == 2
    assert [r.msg_count for r in pairs] == [1, 2]
    assert len(previews) == 2
    assert summaries(query_db, rows, agent='missing') == ([], {}, {})
