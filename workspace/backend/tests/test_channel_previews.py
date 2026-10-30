"""Identical preview semantics on SQLite and read-only PostgreSQL VALUES data."""
import os

import pytest
from sqlalchemy import bindparam, cast, create_engine, select, text, union_all
from sqlalchemy.sql.util import ClauseAdapter

from app.models import EventRecord
from app.routers.events import _dm_privacy_clause
from app.services.channel_previews import latest_channel_query

WID = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
ME = 'me@example.test'


@pytest.fixture(params=['sqlite', 'postgresql'])
def query_db(request, db):
    if request.param == 'sqlite':
        yield db, False
        return
    if os.getenv('OPENAGENTS_TEST_POSTGRES_READONLY') != '1':
        pytest.skip('requires opt-in read-only PostgreSQL connection')
    from app.config import config
    engine = create_engine(config.DATABASE_URL)
    with engine.connect() as conn:
        conn.execute(text('SET TRANSACTION READ ONLY'))
        conn.execute(text("SET LOCAL statement_timeout='5s'"))
        yield conn, True
        conn.rollback()
    engine.dispose()


def previews(query_db, rows, prefix='workspace.message', human=False):
    conn, postgres = query_db
    table = EventRecord.__table__
    # Synthetic rows never touch production tables, including in the PG path.
    columns = [c for c in table.c if c.name != 'created_at']
    def value(i, c, row):
        param = bindparam(f'r{i}_{c.name}', row[c.name], type_=c.type)
        return (cast(param, c.type) if postgres else param).label(c.name)
    selects = [select(*(value(i, c, row) for c in columns)) for i, row in enumerate(rows)]
    events = (union_all(*selects) if len(selects) > 1 else selects[0]).cte('fixture_events')
    filters = []
    if human:
        filters = [events.c.target != 'channel/private',
                   ClauseAdapter(events, adapt_on_names=True).traverse(_dm_privacy_clause(ME))]
    query = latest_channel_query(WID, prefix, filters, postgres=postgres, events=events)
    return {r.target: dict(r._mapping) for r in conn.execute(query)}


def message(id, target='channel/legacy', timestamp=1, **kw):
    return dict(id=id, network_id=WID, target=target, timestamp=timestamp,
                type=kw.pop('type', 'workspace.message.posted'),
                source=kw.pop('source', 'openagents:bot'),
                visibility=kw.pop('visibility', 'channel'),
                payload={'content': id, 'large': 'x' * 1000}, metadata={'id': id}, **kw)


@pytest.mark.parametrize('prefix', ['workspace.message', 'workspace.message.posted', ''])
@pytest.mark.parametrize('human', [False, True])
def test_latest_visible_event_old_legacy_channels_type_and_workspace(query_db, prefix, human):
    rows = [message('old'), message('new', timestamp=2),
            message('private', 'channel/private'),
            message('control', timestamp=10, type='workspace.control'),
            message('foreign', timestamp=20),
            message('nonchannel', 'human:someone@example.test', 30),
            message('private-new', 'channel/private', 40),
            message('visible', 'channel/filter', 1, visibility=None),
            message('hidden', 'channel/filter', 2, visibility='direct', source='human:other@example.test'),
            message('mine', 'channel/own', 2, visibility='direct', source='human:' + ME),
            message('unicode', 'channel/你好/child', 1),
            message('prefix-child', 'channel/subtype', 1, type='workspace.message.posted.extra')]
    rows[4]['network_id'] = OTHER
    got = previews(query_db, rows, prefix, human)
    expected = {'channel/legacy': 'new' if prefix else 'control',
                'channel/filter': 'visible' if human else 'hidden',
                'channel/own': 'mine', 'channel/你好/child': 'unicode',
                'channel/subtype': 'prefix-child'}
    if not human:
        expected['channel/private'] = 'private-new'
    assert {k: r['id'] for k, r in got.items()} == expected
    for row in got.values():
        assert row['payload']['content'] == row['id']
        assert row['metadata'] == {'id': row['id']}


def test_equal_timestamps_use_stable_id_tiebreak(query_db):
    got = previews(query_db, [message('a'), message('z'), message('b')])
    assert got['channel/legacy']['id'] == 'z'


@pytest.mark.parametrize('kind', ['other-workspace', 'no-channels', 'no-matching-type', 'hidden-only'])
def test_empty_result(query_db, kind):
    row = message('one')
    if kind == 'other-workspace':
        row['network_id'] = OTHER
    elif kind == 'no-channels':
        row['target'] = 'agent/one'
    elif kind == 'no-matching-type':
        row['type'] = 'control'
    else:
        row['target'] = 'channel/private'
    assert previews(query_db, [row], human=True) == {}
