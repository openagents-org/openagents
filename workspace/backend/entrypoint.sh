#!/bin/sh
set -e

# Run database migrations (skip with RUN_MIGRATIONS=false for existing databases)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
fi

# Start the application — Railway injects $PORT
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
