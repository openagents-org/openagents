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
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Same SQLite shims the dev server installs (JSONB/UUID compilation, UTC-aware
# datetimes). The suite used to register its own partial copy, so tests ran
# against a SQLite that behaved differently from the one developers run.
from app.database import Base, get_db, install_sqlite_compat  # noqa: E402

install_sqlite_compat()

# Now import the app (which loads models)
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


@pytest.fixture(autouse=True)
def setup_database():
    """Create all tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


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


# ---------------------------------------------------------------------------
# Never emit product analytics from the test suite (see app/services/analytics.py).
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def disable_analytics(monkeypatch):
    from app.config import config as _cfg
    monkeypatch.setattr(_cfg, "ANALYTICS_ENABLED", False)
    yield
