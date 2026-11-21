"""Regression coverage for the October 25 connection-pool outage."""

import pytest
from sqlalchemy import select

from app import db_timeouts
from app.database import SessionLocal


def test_sqlite_sessions_still_work(db):
    with SessionLocal(bind=db.get_bind()) as session:
        assert session.scalar(select(1)) == 1


@pytest.mark.parametrize("value", ["0", "-1", "3; DROP TABLE users", "bad"])
def test_invalid_timeout_fails_at_configuration(monkeypatch, value):
    monkeypatch.setenv("TEST_DB_TIMEOUT", value)
    with pytest.raises(ValueError):
        db_timeouts._positive_ms("TEST_DB_TIMEOUT", 100)


def test_database_timeouts_return_retryable_response_with_cors(client, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from app.routers import workspaces

    def blocked(*args, **kwargs):
        raise OperationalError("query", {}, Exception("lock timeout"))

    monkeypatch.setattr(workspaces, "resolve_current_user", lambda *args: type("Viewer", (), {"id": "test", "email": "test@example.com"})())
    monkeypatch.setattr(workspaces, "select", blocked)
    response = client.get("/v1/workspaces", headers={"Origin": "https://workspace.openagents.org"})
    assert response.status_code == 503
    assert response.headers["retry-after"] == "5"
    assert response.headers["access-control-allow-origin"] == "https://workspace.openagents.org"
    assert "retry" in response.json()["message"].lower()


def test_postgres_timeouts_are_one_round_trip(monkeypatch):
    """All three limits go in one statement, transaction-local (is_local=true)."""
    monkeypatch.setattr(db_timeouts, "STATEMENT_TIMEOUT_MS", 30000)
    monkeypatch.setattr(db_timeouts, "LOCK_TIMEOUT_MS", 3000)
    monkeypatch.setattr(db_timeouts, "IDLE_TRANSACTION_TIMEOUT_MS", 60000)
    sent = []

    class Result:
        def close(self):
            sent.append("closed")

    class Connection:
        dialect = type("Dialect", (), {"name": "postgresql"})()

        def exec_driver_sql(self, sql):
            sent.append(sql)
            return Result()

    db_timeouts.apply_transaction_timeouts(None, None, Connection())
    assert len(sent) == 2 and sent[1] == "closed"
    sql = sent[0]
    assert "set_config('statement_timeout', '30000', true)" in sql
    assert "set_config('lock_timeout', '3000', true)" in sql
    assert "set_config('idle_in_transaction_session_timeout', '60000', true)" in sql
