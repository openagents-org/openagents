"""Transaction-scoped limits for application ORM sessions."""

import os


def _positive_ms(name: str, default: int) -> int:
    value = int(os.environ.get(name, default))
    if value <= 0:
        raise ValueError(f"{name} must be a positive number of milliseconds")
    return value


STATEMENT_TIMEOUT_MS = _positive_ms("DB_STATEMENT_TIMEOUT_MS", 30000)
LOCK_TIMEOUT_MS = _positive_ms("DB_LOCK_TIMEOUT_MS", 3000)
IDLE_TRANSACTION_TIMEOUT_MS = _positive_ms("DB_IDLE_TRANSACTION_TIMEOUT_MS", 60000)


# One statement instead of three SET LOCALs: this listener runs at the start of
# every ORM transaction (hundreds per second on each production node), so each extra statement is
# a database round trip. set_config(..., true) is exactly SET LOCAL: the value
# lasts until commit/rollback, which also keeps it safe under PgBouncer
# transaction pooling. Values are parsed integers, never raw env text.
def transaction_timeouts_sql() -> str:
    """Build the statement from the current values (tests may override them)."""
    return (
        "SELECT "
        f"set_config('statement_timeout', '{int(STATEMENT_TIMEOUT_MS)}', true), "
        f"set_config('lock_timeout', '{int(LOCK_TIMEOUT_MS)}', true), "
        "set_config('idle_in_transaction_session_timeout', "
        f"'{int(IDLE_TRANSACTION_TIMEOUT_MS)}', true)"
    )


def apply_transaction_timeouts(session, transaction, connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    connection.exec_driver_sql(transaction_timeouts_sql()).close()
