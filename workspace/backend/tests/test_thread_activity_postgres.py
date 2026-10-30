"""Exercise the production JSONB aggregate on synthetic rows, without DB writes.

Opt in with OPENAGENTS_TEST_POSTGRES_READONLY=1 and DATABASE_URL pointing at
PostgreSQL. Every query is a read-only transaction; a VALUES CTE shadows events.
The usual SQLite suite skips these PostgreSQL-specific cases.
"""
import json
import os
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from app.services.thread_activity import thread_activity

pytestmark = pytest.mark.skipif(
    os.getenv('OPENAGENTS_TEST_POSTGRES_READONLY') != '1',
    reason='requires opt-in read-only PostgreSQL connection',
)
WID = '11111111-1111-4111-8111-111111111111'
OTHER_WID = '22222222-2222-4222-8222-222222222222'
ME = 'adam@acme.test'


@pytest.fixture(autouse=True)
def frozen_unread_clock(monkeypatch):
    from app.services.unread_window import UNREAD_WINDOW_MS
    monkeypatch.setattr('app.services.unread_window.time', lambda: UNREAD_WINDOW_MS / 1000)


@pytest.fixture
def pg():
    from app.config import config
    engine = create_engine(config.DATABASE_URL)
    with engine.connect() as conn:
        conn.execute(text('SET TRANSACTION READ ONLY'))
        conn.execute(text("SET LOCAL statement_timeout='5s'"))
        yield conn
        conn.rollback()
    engine.dispose()


def message():
    return dict(network_id=WID, target='channel/a', type='workspace.message.posted',
                timestamp=101, visibility='channel', source='openagents:bot',
                payload={'content': 'hello', 'message_type': 'chat'}, metadata={})


def summarize(pg, rows, markers=None, viewer=ME, visible=('a',)):
    columns = ('network_id', 'target', 'type', 'timestamp', 'visibility', 'source', 'payload', 'metadata')
    casts = ('uuid', 'text', 'text', 'bigint', 'text', 'text', 'jsonb', 'jsonb')
    values, params = [], {}
    for i, row in enumerate(rows):
        values.append('(' + ','.join(f'CAST(:event_{i}_{c} AS {t})' for c, t in zip(columns, casts)) + ')')
        params.update({f'event_{i}_{c}': json.dumps(row[c]) if t == 'jsonb' else row[c]
                       for c, t in zip(columns, casts)})
    prefix = f"WITH events({','.join(columns)}) AS (VALUES {','.join(values)}) "

    class SyntheticSession:
        def get_bind(self):
            return pg

        def execute(self, query, bindings):
            return pg.execute(text(prefix + str(query)), {**params, **bindings})

    return thread_activity(SyntheticSession(), WID,
                           [SimpleNamespace(name=n) for n in visible],
                           markers if markers is not None else {'a': 100}, viewer)


def test_marker_boundaries_visibility_workspace_type_and_completion(pg):
    base = message()
    rows = [dict(base, timestamp=100),
            dict(base, timestamp=101, source='human:' + ME),
            dict(base, timestamp=102, metadata={'requester_email': ME}),
            dict(base, timestamp=103, metadata={'requester_email': 'other@acme.test'}),
            dict(base, timestamp=104, metadata={'requester_email': ME.upper()}),
            dict(base, timestamp=105, visibility='direct'),
            dict(base, timestamp=106, visibility=None),
            dict(base, timestamp=107, network_id=OTHER_WID),
            dict(base, timestamp=108, type='workspace.message.posted.extra'),
            dict(base, timestamp=109, target='channel/hidden'),
            dict(base, timestamp=200, target='channel/b'),
            dict(base, timestamp=201, target='channel/b', metadata={'requester_email': ME})]
    got = summarize(pg, rows, {'a': 100, 'b': 200, 'empty': 0, 'hidden': 0}, visible=('a', 'b', 'empty'))
    assert got == {
        'a': {'read_at': 100, 'unread_count': 3, 'completion_at': 102},
        'b': {'read_at': 200, 'unread_count': 1, 'completion_at': 201},
        'empty': {'read_at': 0, 'unread_count': 0, 'completion_at': None},
    }


@pytest.mark.parametrize('source,payload,metadata,expected', [
    ('human:  ADAM@ACME.TEST\u2003', {}, {}, 0),
    ('human:other@acme.test', {'sender_email': ME}, {}, 1),
    ('human:user', {'sender_email': ME.upper()}, {}, 0),
    ('human:user', {}, {'sender_email': '\t' + ME + '\u00a0'}, 0),
    ('human:user', {'sender_id': ME}, {}, 0),
    ('human:user', {'sender_email': 12, 'sender_id': ME}, {}, 0),
    ('human:user', {'sender_email': 'bad@@email', 'sender_id': ME}, {}, 0),
    ('human:user', {'sender_email': 'bad\u2003@x.test', 'sender_id': ME}, {}, 0),
    ('human:user', {'sender_email': '@x.test', 'sender_id': ME}, {}, 0),
    ('human:user', {'sender_email': 'other@x.test', 'sender_id': ME}, {}, 1),
    ('human:user', {'sender_id': ME}, {'sender_email': 'other@x.test'}, 1),
    ('human:user', {}, {}, 1),
    ('openagents:bot', {'sender_email': ME}, {'requester_email': ME}, 1),
])
def test_legacy_sender_identity_and_precedence(pg, source, payload, metadata, expected):
    row = message()
    row.update(source=source, payload={**row['payload'], **payload}, metadata=metadata)
    got = summarize(pg, [row])['a']
    assert got['unread_count'] == expected
    assert got['completion_at'] == (101 if source == 'openagents:bot' else None)


@pytest.mark.parametrize('value', [None, False, 0, 0.0, '', [], {}])
def test_json_false_values_do_not_count_as_content_but_default_message_type(pg, value):
    row = message()
    assert summarize(pg, [dict(row, payload={'content': value})])['a']['unread_count'] == 0
    assert summarize(pg, [dict(row, payload={'content': 'hello', 'message_type': value})])['a']['unread_count'] == 1


@pytest.mark.parametrize('value', ['hello', ' ', True, 1, -1, ['hello'], {'text': 'hello'}])
def test_truthy_legacy_content_counts(pg, value):
    row = message()
    assert summarize(pg, [dict(row, payload={'content': value})])['a']['unread_count'] == 1


@pytest.mark.parametrize('kind', ['thinking', 'status', 'CHAT', True, 1, ['chat'], {'kind': 'chat'}])
def test_non_chat_messages_excluded(pg, kind):
    row = message()
    assert summarize(pg, [dict(row, payload={'content': 'hello', 'message_type': kind})])['a']['unread_count'] == 0


def test_anonymous_viewer_has_no_self_exclusion_or_completion(pg):
    rows = [dict(message(), source='human:' + ME), dict(message(), metadata={'requester_email': ME})]
    assert summarize(pg, rows, viewer=None)['a'] == {'read_at': 100, 'unread_count': 2, 'completion_at': None}


def test_thirty_day_window_and_read_marker_boundaries(pg, monkeypatch):
    from app.services.unread_window import UNREAD_WINDOW_MS
    cutoff = 1_800_000_000_000
    monkeypatch.setattr('app.services.unread_window.time', lambda: (cutoff + UNREAD_WINDOW_MS) / 1000)
    rows = [dict(message(), timestamp=at, metadata={'requester_email': ME})
            for at in (cutoff - 1, cutoff, cutoff + 1)]
    assert summarize(pg, rows)['a'] == {'read_at': 100, 'unread_count': 2, 'completion_at': cutoff + 1}
    assert summarize(pg, rows, {'a': cutoff})['a']['unread_count'] == 1
    assert summarize(pg, rows, {'a': cutoff + 1})['a']['unread_count'] == 0
    monkeypatch.setattr('app.services.unread_window.time', lambda: (cutoff + UNREAD_WINDOW_MS + 2) / 1000)
    assert summarize(pg, rows)['a'] == {'read_at': 100, 'unread_count': 0, 'completion_at': None}


def test_no_visible_markers_does_not_query_database():
    class NoQueries:
        def get_bind(self):
            raise AssertionError('No query needed')
    assert thread_activity(NoQueries(), WID, [], {'hidden': 0}, ME) == {}
