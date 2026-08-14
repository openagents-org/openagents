# -*- coding: utf-8 -*-
"""
Test fixtures for the workspace backend.

Uses SQLite in-memory database for fast isolated tests.
Registers custom compilers so PostgreSQL-specific types work with SQLite.
Uses StaticPool to share a single in-memory database across all connections.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Register PostgreSQL types for SQLite compilation
SQLiteTypeCompiler.visit_JSONB = lambda self, type_, **kw: "JSON"
SQLiteTypeCompiler.visit_UUID = lambda self, type_, **kw: "TEXT"

# Now import the app (which loads models)
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

# ---------------------------------------------------------------------------
# Test database setup — StaticPool ensures all connections share one DB
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


# Translate Postgres-specific server defaults (NOW(), gen_random_uuid()) to
# SQLite-friendly equivalents at SQL-emit time. Production uses Postgres and
# is unaffected — this only fires for the test engine. Without this, CREATE
# TABLE fails because SQLite doesn't recognize NOW().
@event.listens_for(engine, "before_cursor_execute", retval=True)
def _rewrite_pg_to_sqlite(conn, cursor, statement, parameters, context, executemany):
    if "DEFAULT NOW()" in statement:
        statement = statement.replace("DEFAULT NOW()", "DEFAULT CURRENT_TIMESTAMP")
    if "DEFAULT gen_random_uuid()" in statement:
        # SQLite has no UUID generator; Python-side default=_uuid handles INSERTs.
        statement = statement.replace("DEFAULT gen_random_uuid()", "")
    return statement, parameters


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


# ---------------------------------------------------------------------------
# Background services
# ---------------------------------------------------------------------------
#
# Posting a message schedules BackgroundTasks — push fan-out, cloud-agent
# invocation, workflow advancement — and each opens its *own* session rather
# than reusing the request's, since the request's is already closed by the time
# they run. They bind `SessionLocal` at import, so `dependency_overrides` never
# reaches them and they dial the real Postgres from `DATABASE_URL`.
#
# TestClient runs background tasks inline and lets their exceptions escape, so
# without this any test that posts a chat message fails on a refused connection
# to localhost:5432 — nothing to do with what the test was checking. Rebinding
# each module's reference points them at the same in-memory database as the
# request path, so they exercise real code against real rows.
def _bind_background_services_to_test_db() -> None:
    from app.services import cloud_agent, cloud_agent_queue, push, workflow

    for module in (push, cloud_agent, cloud_agent_queue, workflow):
        module.SessionLocal = TestingSessionLocal


_bind_background_services_to_test_db()


@pytest.fixture(autouse=True)
def setup_database():
    """Create all tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def isolated_file_storage(tmp_path, monkeypatch):
    """Give each test its own file-storage directory.

    The default is a fixed path under /tmp, shared by every run and every user
    on the machine. That fails outright when the directory was created by
    someone else, and even when it works, uploads accumulate there forever and
    one test can see another's files. The store is a cached singleton, so it
    also has to be cleared — otherwise whichever test uploaded first pins the
    directory for the rest of the session.
    """
    from app import storage
    from app.config import config

    monkeypatch.setattr(config, "FILE_STORAGE_PATH", str(tmp_path / "files"))
    monkeypatch.setattr(config, "FILE_STORAGE_BACKEND", "local")
    monkeypatch.setattr(storage, "_store", None)
    yield
    storage._store = None


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def db():
    """Direct database session for test setup/assertions."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def workspace(client):
    """Create a workspace and return its details (id, slug, token)."""
    resp = client.post("/v1/workspaces", json={
        "name": "Test Workspace",
        "agent_name": "agent-alpha",
        "creator_email": "test@example.com",
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    return {
        "id": data["workspaceId"],
        "slug": data["slug"],
        "name": "Test Workspace",
        "token": data["token"],
        "channel": data["channel"],
    }
