FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements.production.lock ./
RUN pip install --no-cache-dir -r requirements.txt -c requirements.production.lock 'PyYAML>=6.0'
# Explicit runtime allowlist: no credentials, tests, Git history or operations files.
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY openagents/ ./openagents/
COPY cloud_providers/ ./cloud_providers/
COPY registry/ ./registry/
COPY alembic.ini entrypoint.sh ./
RUN chmod +x entrypoint.sh
ARG RELEASE_SHA
LABEL org.opencontainers.image.revision=$RELEASE_SHA
ENV PYTHONPATH=/app PYTHONUNBUFFERED=1
EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
