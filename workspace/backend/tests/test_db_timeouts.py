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

    monkeypatch.setattr(workspaces, "select", blocked)
    response = client.get("/v1/workspaces", headers={"Origin": "https://workspace.openagents.org"})
    assert response.status_code == 503
    assert response.headers["retry-after"] == "5"
    assert response.headers["access-control-allow-origin"] == "https://workspace.openagents.org"
    assert "retry" in response.json()["message"].lower()
