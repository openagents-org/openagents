"""Read-only requests return their DB connection when the endpoint returns."""
from uuid import uuid4

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.database import get_db, release_if_read_only, release_read_only_db
from app.models import EventRecord


def test_read_only_transaction_is_released_without_expiring_objects(db, workspace):
    row = db.execute(select(EventRecord).limit(1)).first()  # opens a transaction
    assert db.in_transaction()
    assert release_if_read_only(db) is True
    assert not db.in_transaction()
    # Loaded objects stay usable without a new query.
    ws = db.execute(text("select 1")).scalar()
    assert ws == 1


def test_loaded_attributes_survive_release(db, workspace):
    from app.models import Workspace
    ws = db.get(Workspace, workspace['id'])
    assert release_if_read_only(db) is True
    statements = []
    from sqlalchemy import event
    listener = lambda *a: statements.append(a[2])
    event.listen(db.bind, 'before_cursor_execute', listener)
    try:
        assert ws.id == workspace['id'] and ws.name
    finally:
        event.remove(db.bind, 'before_cursor_execute', listener)
    assert statements == [], 'attributes were not expired by the release'


def test_flushed_uncommitted_write_is_left_alone(db, workspace):
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source='human:x', target='channel/general',
                       timestamp=1, type='workspace.message.posted', visibility='channel', payload={}))
    db.flush()
    assert release_if_read_only(db) is False
    db.rollback()
    assert db.execute(select(EventRecord).where(EventRecord.timestamp == 1)).first() is None


def test_pending_changes_are_left_alone(db, workspace):
    db.execute(select(1))
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source='human:x', target='channel/general',
                       timestamp=2, type='workspace.message.posted', visibility='channel', payload={}))
    assert release_if_read_only(db) is False


def test_connection_level_write_is_detected(db, workspace):
    db.connection().execute(text("UPDATE workspaces SET name = name WHERE id = :id"), {"id": workspace['id']})
    assert release_if_read_only(db) is False


def test_reads_after_an_explicit_commit_are_released(db, workspace):
    db.add(EventRecord(id=str(uuid4()), network_id=workspace['id'], source='human:x', target='channel/general',
                       timestamp=3, type='workspace.message.posted', visibility='channel', payload={}))
    db.commit()
    db.execute(select(EventRecord).limit(1))
    assert release_if_read_only(db) is True


def test_release_runs_after_the_endpoint_and_before_close():
    events = []

    class FakeSession:
        info = {}
        new = dirty = deleted = ()

        def in_transaction(self):
            events.append('check'); return False

        def close(self):
            events.append('close')

    def fake_get_db():
        s = FakeSession()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI(dependencies=[Depends(release_read_only_db, scope="function")])
    app.dependency_overrides[get_db] = fake_get_db

    @app.get('/x')
    def x(db=Depends(get_db)):
        events.append('handler')
        return {}

    TestClient(app).get('/x')
    assert events == ['handler', 'check', 'close']
