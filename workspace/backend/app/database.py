# -*- coding: utf-8 -*-
"""
Database connection and session management.

Uses SQLAlchemy with any PostgreSQL database (not Supabase-specific).
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session, declarative_base
from sqlalchemy.pool import NullPool, QueuePool

from app.config import config

# Use NullPool for serverless (Vercel) or SQLite — no persistent connections.
# Use QueuePool for long-running servers (Docker/uvicorn) with PostgreSQL.
_is_serverless = os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
_is_sqlite = config.DATABASE_URL.startswith("sqlite")

# Register PostgreSQL type compilers for SQLite so JSONB/UUID columns work.
if _is_sqlite:
    from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
    if not hasattr(SQLiteTypeCompiler, "_orig_visit_JSONB"):
        SQLiteTypeCompiler.visit_JSONB = lambda self, type_, **kw: "JSON"
        SQLiteTypeCompiler.visit_UUID = lambda self, type_, **kw: "TEXT"

# A PgBouncer pooler in front of Postgres maintains its own backend pool,
# so app-level pooling is redundant and causes stale-connection failures
# ("SSL connection has been closed unexpectedly") because pgbouncer may
# rotate or idle-kill the TCP connection our app still thinks is fresh.
# Use NullPool in pgbouncer mode: each request opens a short-lived conn
# that goes straight to pgbouncer (co-located, ~1ms overhead), and pgbouncer
# multiplexes those onto a small fixed set of real Postgres backends — which
# lifts the ~100-connection Postgres ceiling that forced the app pool down.
#
# Detected by Supabase's pooler port (:6543) OR an explicit DB_PGBOUNCER
# flag. A self-hosted/Railway pgbouncer listens on a different port (commonly
# 6432), so the port alone isn't a reliable signal — the flag is.
_is_pgbouncer = (
    ":6543/" in config.DATABASE_URL
    or os.environ.get("DB_PGBOUNCER", "").strip().lower() in ("1", "true", "yes")
)

_pool_kwargs = (
    {"poolclass": NullPool}
    if _is_serverless or _is_sqlite or _is_pgbouncer
    # Direct-PG mode (port 5432): keep a bounded per-worker pool.
    # Sized for Railway Postgres max_connections=400 (raised from 200 via
    # ALTER SYSTEM on 2026-06-12) at 2 replicas × 2 workers
    # (WEB_CONCURRENCY=2): 2 × 2 × (40 + 8) = 192 max DB conns steady-state,
    # leaving headroom for a rolling deploy (old + new replicas briefly
    # coexist → up to 384 conns, under 400 minus the 3 superuser-reserved).
    # Keep THREADPOOL_TOKENS in app/main.py equal to pool_size+max_overflow
    # so `def` handlers queue for a thread instead of stampeding the pool.
    # Blocking DB work must run in the threadpool, including DB phases of
    # async handlers. A pool wait on the event loop also delays DB cleanup.
    # Keep pool_timeout short (2s) so exhausted pools don't tie up threads.
    else {"pool_pre_ping": True, "pool_size": 40, "max_overflow": 8, "pool_recycle": 300, "pool_timeout": 2, "poolclass": QueuePool}
)

# Keep the TCP connection alive to survive NAT / firewall idle timeouts
# between Railway egress and Supabase. Without these, idle connections
# get silently FIN/RST'd and we see "SSL connection has been closed
# unexpectedly" mid-query.
# keepalives_idle=30: start probing after 30s of idle
# keepalives_interval=10: probe every 10s
# keepalives_count=3: drop the conn after 3 failed probes
_connect_args = {}
if not _is_sqlite:
    _connect_args.update({
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
        # TCP-level timeout for the initial connect.
        "connect_timeout": 10,
    })

# PgBouncer transaction mode doesn't support prepared statements or the
# 'options' startup parameter. Disable SQLAlchemy statement caching so
# no PREPARE/DEALLOCATE is issued.
_engine_kwargs = {**_pool_kwargs}
if _connect_args:
    _engine_kwargs["connect_args"] = _connect_args
if _is_pgbouncer:
    _engine_kwargs["execution_options"] = {"no_cache": True}

engine = create_engine(config.DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
