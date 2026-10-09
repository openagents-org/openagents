"""Incident regressions: free connections before I/O and keep liveness responsive."""
import asyncio
import sqlite3
import threading

import httpx
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import OperationalError, TimeoutError as PoolTimeoutError
from sqlalchemy.pool import QueuePool

from app import database, main
from app.database import get_db
from app.models import CloudAgentConfig, ModelAccess
from app.services import model_probe
from tests.conftest import TestingSessionLocal


@pytest.mark.parametrize('kind', ['saved', 'raw', 'cloud'])
def test_model_probe_releases_transaction_before_provider_call(client, workspace, db, monkeypatch, kind):
    entry = ModelAccess(workspace_id=workspace['id'], provider='openai', label='test', api_key='test-secret')
    cloud = CloudAgentConfig(workspace_id=workspace['id'], agent_name='test-models', provider='openai', model='test', api_key='test-secret')
    db.add_all([entry, cloud])
    db.commit()
    access_id = entry.id
    db.close()
    sessions, db_threads, provider_threads = [], [], []

    def request_db():
        with TestingSessionLocal() as session:
            sessions.append(session)
            event.listen(session, 'after_begin', lambda *args: db_threads.append(threading.get_ident()))
            yield session

    async def probe(provider, key, base_url, model, protocol=None):
        assert key == 'test-secret'
        assert sessions and all(not s.in_transaction() for s in sessions)
        provider_threads.append(threading.get_ident())
        await asyncio.sleep(0)
        return {'models': [{'id': 'test', 'label': 'Test'}], 'source': 'live', 'keyOk': True}

    monkeypatch.setitem(main.app.dependency_overrides, get_db, request_db)
    monkeypatch.setattr(model_probe, 'probe', probe)
    path = {'saved': f'/v1/model-access/{access_id}/probe', 'raw': '/v1/model-probe', 'cloud': '/v1/cloud-agents/test-models/models'}[kind]
    body = {'network': workspace['id']}
    if kind == 'raw':
        body.update(provider='openai', api_key='test-secret')
    response = client.post(path, json=body, headers={'X-Workspace-Token': workspace['token']})
    assert response.status_code == 200, response.text
    assert response.json()['data']['keyOk'] is True
    assert db_threads and provider_threads
    assert set(db_threads).isdisjoint(provider_threads)
    # A different credential cannot bypass the workspace authorization step.
    denied = client.post(path, json=body, headers={'X-Workspace-Token': 'wrong'})
    assert denied.status_code == 401


@pytest.mark.parametrize('error', [PoolTimeoutError('pool busy'), OperationalError('SELECT secret', {}, Exception('private detail'))])
def test_database_errors_are_retryable_and_readable_by_browser(client, monkeypatch, error):
    def unavailable_db():
        raise error
        yield  # retain the dependency's generator contract
    monkeypatch.setitem(main.app.dependency_overrides, get_db, unavailable_db)
    origin = main.origins[0] if main.origins[0] != '*' else 'https://workspace.openagents.org'
    response = client.get('/v1/model-access?network=missing', headers={'Origin': origin})
    assert response.status_code == 503
    assert response.headers['retry-after'] == '5'
    assert response.headers['access-control-allow-origin'] in ('*', origin)
    assert response.json()['code'] == 503
    assert 'private detail' not in response.text and 'SELECT secret' not in response.text


def test_readiness_fails_for_exhausted_pool_while_liveness_remains_responsive(monkeypatch):
    engine = create_engine('sqlite://', poolclass=QueuePool, pool_size=1, max_overflow=0,
                           pool_timeout=0.2, connect_args={'check_same_thread': False})
    held = engine.connect()
    waiting = threading.Event()
    connect = engine.connect
    def checked_connect():
        waiting.set()
        return connect()
    monkeypatch.setattr(engine, 'connect', checked_connect)
    monkeypatch.setattr(database, 'engine', engine)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
            pending = asyncio.create_task(client.get('/ready'))
            while not waiting.is_set():
                await asyncio.sleep(0.001)
            assert (await client.get('/health')).status_code == 200
            assert not pending.done()
            unavailable = await pending
            assert unavailable.status_code == 503
            assert unavailable.json()['database'] == 'unavailable'
            held.close()
            recovered = await client.get('/ready')
            assert recovered.status_code == 200
            assert recovered.json()['database'] == 'ok'
    try:
        asyncio.run(exercise())
    finally:
        held.close()
        engine.dispose()


def test_timer_pool_wait_does_not_block_event_loop(monkeypatch):
    pool = QueuePool(lambda: sqlite3.connect(':memory:', check_same_thread=False), pool_size=1, max_overflow=0, timeout=0.2)
    waiting = threading.Event()
    class EmptySession:
        connection = None
        def execute(self, *args, **kwargs):
            waiting.set()
            if self.connection is None:
                self.connection = pool.connect()
            return self
        def scalars(self): return self
        def all(self): return []
        def commit(self): pass
        def close(self):
            if self.connection is not None: self.connection.close()
    monkeypatch.setattr(database, 'SessionLocal', EmptySession)

    async def exercise():
        held = pool.connect()
        pending = asyncio.create_task(main._fire_due())
        try:
            while not waiting.is_set():
                await asyncio.sleep(0.001)
            assert not pending.done()
            held.close()
            await pending
        finally:
            held.close()
            await asyncio.gather(pending, return_exceptions=True)
    try:
        asyncio.run(exercise())
    finally:
        pool.dispose()
