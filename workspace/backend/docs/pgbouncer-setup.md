# PgBouncer pooler for the workspace backend (Railway)

## Why

Railway Postgres caps total connections at ~100. With 2 replicas × 2 workers
each holding a `pool_size=20 + max_overflow=4` pool, steady-state is already
~96 connections — and a *rolling deploy* (old + new pods briefly coexisting)
doubles that, which is why the pool was halved (`6ad36f61`). That small pool
is what got exhausted during the `_timer_loop` incident.

A PgBouncer pooler removes the ceiling as a constraint: the app opens many
short-lived connections to pgbouncer, and pgbouncer multiplexes them onto a
small fixed set of real Postgres backends. Postgres backend connections stay
constant (= pgbouncer's pool size) no matter how many app workers/replicas or
how big a deploy overlaps.

## Code side (already in repo)

`app/database.py` switches to `NullPool` + disables SQLAlchemy's statement
cache when pooler mode is on. Enable it with the env var:

```
DB_PGBOUNCER=1
```

(Detection also still triggers on Supabase's `:6543` port.) This is a no-op
until set, so the code can ship ahead of the infra cutover.

For a **remote** pooler (for example a DigitalOcean managed connection pool on
port 25061), also set:

```
DB_PGBOUNCER_CLIENT_POOL=1
DB_POOL_SIZE=6        # client connections to the pooler, per worker
DB_MAX_OVERFLOW=2
```

Each worker then keeps a small pool of client connections to the pooler
instead of opening a new TCP+TLS connection per request, and the SQLAlchemy
compiled-SQL cache stays on (it is client-side; psycopg2 never issues
server-side `PREPARE`, so it is safe in transaction mode). The pooler's own
size caps the real Postgres connections.

## Railway setup

1. **Add a new service** in the `workspace-backend` project / `production`
   environment from the public image:

   ```
   edoburu/pgbouncer:latest      # pin a digest/tag in practice
   ```

2. **Set its variables** (use Railway references so the password isn't copied):

   | Variable            | Value                              |
   |---------------------|------------------------------------|
   | `DB_HOST`           | `postgres.railway.internal`        |
   | `DB_PORT`           | `5432`                             |
   | `DB_USER`           | `postgres`                         |
   | `DB_PASSWORD`       | `${{Postgres.PGPASSWORD}}`         |
   | `DB_NAME`           | `railway`                          |
   | `POOL_MODE`         | `transaction`                      |
   | `MAX_CLIENT_CONN`   | `1000`                             |
   | `DEFAULT_POOL_SIZE` | `25`                               |
   | `MIN_POOL_SIZE`     | `5`                                |
   | `RESERVE_POOL_SIZE` | `5`                                |
   | `AUTH_TYPE`         | `scram-sha-256`                    |
   | `LISTEN_PORT`       | `6432`                             |

   Sizing: one pgbouncer instance holds at most
   `DEFAULT_POOL_SIZE + RESERVE_POOL_SIZE = 30` real Postgres backends — far
   under the ~100 cap — while serving up to `MAX_CLIENT_CONN=1000` app
   connections. `transaction` mode gives the best multiplexing for this
   request-per-transaction workload and is compatible with the app's
   NullPool + no-prepared-statements config.

3. **Point the app at pgbouncer.** On the `workspace-backend` service set:

   ```
   DATABASE_URL = postgresql://postgres:${{Postgres.PGPASSWORD}}@<pgbouncer-service>.railway.internal:6432/railway
   DB_PGBOUNCER = 1
   ```

   (Keep the old direct `DATABASE_URL` value handy for instant rollback.)

4. **Redeploy** `workspace-backend`. Verify:
   - `/health` and `/v1/discover` return 200 at normal latency.
   - Logs show no `QueuePool`/`TimeoutError` and no
     `prepared statement ... does not exist` (the latter would mean
     transaction mode without the no-cache/NullPool settings — but those are
     already applied when `DB_PGBOUNCER=1`).

## Rollback

Set `DATABASE_URL` back to the direct `postgres.railway.internal:5432` value
and remove `DB_PGBOUNCER`, then redeploy. The pooler service can be left
running (idle) or deleted.

## Optional follow-up

Once pgbouncer is stable, the app's own `pool_size`/overflow no longer gates
Postgres connections (NullPool in pooler mode), so the rolling-deploy
connection-doubling problem that forced the small pool goes away.
