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


def apply_transaction_timeouts(session, transaction, connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    # Values are parsed as positive integers, never interpolated raw env text.
    for setting, value in (
        ("statement_timeout", STATEMENT_TIMEOUT_MS),
        ("lock_timeout", LOCK_TIMEOUT_MS),
        ("idle_in_transaction_session_timeout", IDLE_TRANSACTION_TIMEOUT_MS),
    ):
        connection.exec_driver_sql(f"SET LOCAL {setting} = {value}")
