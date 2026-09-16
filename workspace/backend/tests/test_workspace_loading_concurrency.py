"""Database contention must not stop the event loop serving workspace loads."""

import asyncio
import sqlite3
import threading

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.pool import QueuePool

from app.database import get_db
from app.routers import browser, knowledge, notifications


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/v1/notifications?network=missing", None),
    ("POST", "/v1/notifications", {
        "network": "missing", "source": "test", "title": "t", "message": "m",
    }),
    ("GET", "/v1/notifications/missing", None),
    ("PATCH", "/v1/notifications/missing/read", None),
    ("PATCH", "/v1/notifications/read-all?network=missing", None),
    ("DELETE", "/v1/notifications/missing", None),
    ("GET", "/v1/knowledge?network=missing", None),
    ("GET", "/v1/knowledge/missing", None),
    ("GET", "/v1/knowledge/by-slug/missing?network=missing", None),
    ("GET", "/v1/browser/tabs?network=missing", None),
])
def test_pool_contention_allows_health_and_connection_release(method, path, body):
    # A real blocking QueuePool reproduces the production wait without needing
    # PostgreSQL or a slow query. Exhaust its sole slot before sending requests.
    pool = QueuePool(
        lambda: sqlite3.connect(":memory:", check_same_thread=False),
        pool_size=1, max_overflow=0, timeout=0.2,
    )
    waiting = threading.Event()

    class MissingRowSession:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.close()

        def execute(self, *args, **kwargs):
            waiting.set()
            connection = pool.connect()
            connection.close()
            return self

        def scalar_one_or_none(self):
            return None

        def close(self):
            pass

    app = FastAPI()
    for router in (notifications.router, knowledge.router, browser.router):
        app.include_router(router)

    def session():
        yield MissingRowSession()

    app.dependency_overrides[get_db] = session

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    async def exercise():
        held = pool.connect()
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            requests = [asyncio.create_task(client.request(method, path, json=body))
                        for _ in range(8)]
            try:
                async def wait_for_checkout():
                    while not waiting.is_set():
                        await asyncio.sleep(0.001)

                await asyncio.wait_for(wait_for_checkout(), timeout=5)
                # Health and connection cleanup must run while a handler is
                # waiting. If the loop is blocked, the requests time out first.
                assert (await client.get("/health")).status_code == 200
                held.close()
                responses = await asyncio.gather(*requests)
                assert [r.status_code for r in responses] == [404] * 8
            finally:
                held.close()
                await asyncio.gather(*requests, return_exceptions=True)

    try:
        asyncio.run(exercise())
    finally:
        pool.dispose()
