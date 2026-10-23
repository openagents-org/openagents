"""HTTP replicas retain initialization without starting duplicate schedulers."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
import app.main as main
import app.database as database
import app.browser as browser
import app.browser_maintenance as maintenance


@pytest.mark.parametrize('enabled', [None, 'false', 'true'])
def test_replica_lifespan(monkeypatch, enabled):
    if enabled is None:
        monkeypatch.delenv('BACKGROUND_JOBS_ENABLED', raising=False)
    else:
        monkeypatch.setenv('BACKGROUND_JOBS_ENABLED', enabled)
    monkeypatch.setenv('THREADPOOL_TOKENS', '6')
    monkeypatch.setattr(database, '_is_sqlite', False)
    started, cancelled = [], []

    async def job(name):
        started.append(name)
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(name)

    monkeypatch.setattr(main, '_timer_loop', lambda: job('timer'))
    monkeypatch.setattr(maintenance, 'sweep_browser_tabs', lambda: job('browser'))
    manager = MagicMock(shutdown=AsyncMock())
    monkeypatch.setattr(browser.BrowserManager, 'get', lambda: manager)

    async def run():
        import anyio.to_thread
        async with main.lifespan(main.app):
            await asyncio.sleep(0)
            assert anyio.to_thread.current_default_thread_limiter().total_tokens == 6
            assert sorted(started) == ([] if enabled == 'false' else ['browser', 'timer'])
        assert sorted(cancelled) == sorted(started)
        manager.shutdown.assert_awaited_once()

    asyncio.run(run())
