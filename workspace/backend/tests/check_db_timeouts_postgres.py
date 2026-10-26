"""Opt-in, data-free PostgreSQL check: python tests/check_db_timeouts_postgres.py.

Uses only SELECTs, transaction-local settings, and a random advisory lock. Never
creates tables or changes data/configuration. DATABASE_URL selects the server.
"""

import time
import uuid

from sqlalchemy import event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app import db_timeouts


def check():
    assert engine.dialect.name == "postgresql"
    db_timeouts.STATEMENT_TIMEOUT_MS = 200
    db_timeouts.LOCK_TIMEOUT_MS = 100
    db_timeouts.IDLE_TRANSACTION_TIMEOUT_MS = 300
    factory = sessionmaker(bind=engine)
    event.listen(factory, "after_begin", db_timeouts.apply_transaction_timeouts)

    with engine.connect() as connection:
        original = connection.scalar(text("SHOW statement_timeout"))
        connection.rollback()
        with factory(bind=connection) as session:
            assert session.scalar(text("SHOW statement_timeout")) == "200ms"
            session.commit()
        assert connection.scalar(text("SHOW statement_timeout")) == original
        connection.rollback()
    print("transaction settings reset after commit", flush=True)

    with factory() as session:
        try:
            session.execute(text("SELECT pg_sleep(1)"))
        except OperationalError as exc:
            assert exc.orig.pgcode == "57014", exc.orig.pgcode
            session.rollback()
        else:
            raise AssertionError("statement timeout did not fire")
        assert session.scalar(text("SELECT 1")) == 1
    print("slow query cancelled; session usable after rollback", flush=True)

    key = uuid.uuid4().int % (2**63)
    with engine.connect() as holder, factory() as waiter:
        holder.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
        try:
            waiter.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
        except OperationalError as exc:
            assert exc.orig.pgcode == "55P03", exc.orig.pgcode
            waiter.rollback()
        else:
            raise AssertionError("lock timeout did not fire")
        finally:
            holder.rollback()
    print("blocked query cancelled by lock timeout", flush=True)

    with factory() as session:
        session.execute(text("SELECT 1"))
        time.sleep(0.6)
        try:
            session.execute(text("SELECT 1"))
        except OperationalError:
            session.rollback()
        else:
            raise AssertionError("idle transaction was not disconnected")
        assert session.scalar(text("SELECT 1")) == 1
    print("idle transaction disconnected; session reconnects after rollback", flush=True)


if __name__ == "__main__":
    check()
