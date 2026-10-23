"""A slow file lookup must not stall unrelated requests on the same worker."""

import asyncio
import threading
import time

import httpx
from fastapi import FastAPI

from app.database import get_db
from app.routers.files import router


def test_slow_download_lookup_does_not_block_other_requests():
    started = threading.Event()
    release = threading.Event()

    class SlowDB:
        def execute(self, statement):
            started.set()
            assert release.wait(3), "test lookup was not released"
            return self

        def scalar_one_or_none(self):
            return None

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: SlowDB()

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            # The fallback releases even a regressed event-loop-blocking route;
            # latency is measured from before dispatch, not after loop resumes.
            fallback = threading.Timer(2, release.set)
            fallback.start()
            before = time.monotonic()
            download = asyncio.create_task(client.get("/v1/files/missing"))
            try:
                assert await asyncio.to_thread(started.wait, 3)
                response = await client.get("/ping")
                elapsed = time.monotonic() - before
                assert response.status_code == 200
                assert elapsed < 1, "slow file database lookup blocked the event loop"
            finally:
                release.set()
                fallback.cancel()
                response = await download
            assert response.status_code == 404

    asyncio.run(check())
