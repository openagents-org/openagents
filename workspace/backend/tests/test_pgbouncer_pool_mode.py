"""PgBouncer mode: NullPool by default, a client pool when asked for one."""
import json
import os
import subprocess
import sys

import pytest

PROBE = ("import json; from app.database import engine; "
         "print(json.dumps([type(engine.pool).__name__, engine.get_execution_options().get('no_cache', False)]))")


def probe(**env):
    pytest.importorskip("psycopg2")
    full = {**os.environ, "DATABASE_URL": "postgresql://u:p@pooler.invalid:25061/db", **env}
    for key in ("DB_PGBOUNCER", "DB_PGBOUNCER_CLIENT_POOL"):
        if key not in env:
            full.pop(key, None)
    out = subprocess.run([sys.executable, "-c", PROBE], env=full, capture_output=True, text=True,
                         cwd=os.path.dirname(os.path.dirname(__file__)), check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_direct_postgres_uses_a_queue_pool():
    assert probe() == ["QueuePool", False]


def test_pgbouncer_mode_defaults_to_nullpool_without_compiled_cache():
    assert probe(DB_PGBOUNCER="true") == ["NullPool", True]


def test_pgbouncer_client_pool_keeps_pool_and_cache():
    assert probe(DB_PGBOUNCER="true", DB_PGBOUNCER_CLIENT_POOL="true") == ["QueuePool", False]
