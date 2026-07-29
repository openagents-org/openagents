# -*- coding: utf-8 -*-
"""
Tests for concurrent cloud agent invocation.

invoke_cloud_agents fans out to every targeted agent, but must dedupe
duplicate targets (duplicate mentions would double-invoke a billable
provider API) and bound the concurrency so a large mention list can't
exhaust the DB connection pool.
"""

import asyncio
from unittest.mock import MagicMock, patch

from app.config import config
from app.services import cloud_agent


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _event(targets, depth=0):
    metadata = {"target_agents": targets}
    if depth:
        metadata["cloud_agent_depth"] = depth
    return {
        "target": "channel/general",
        "payload": {"content": "hi"},
        "metadata": metadata,
    }


class TestInvokeCloudAgents:

    def test_duplicate_targets_invoked_once(self):
        calls = []

        async def fake(workspace_id, event_data, name, depth):
            calls.append(name)

        with patch.object(cloud_agent, "_invoke_guarded", side_effect=fake):
            _run(cloud_agent.invoke_cloud_agents(
                "ws1", _event(["agent-a", "agent-b", "agent-a", "agent-a"]),
            ))
        assert calls == ["agent-a", "agent-b"]

    def test_sentinel_only_no_invocations(self):
        mock = MagicMock()
        with patch.object(cloud_agent, "_invoke_guarded", mock):
            _run(cloud_agent.invoke_cloud_agents("ws1", _event(["__no_response__"])))
        mock.assert_not_called()

    def test_sentinel_mixed_with_real_targets_is_dropped(self):
        calls = []

        async def fake(workspace_id, event_data, name, depth):
            calls.append(name)

        with patch.object(cloud_agent, "_invoke_guarded", side_effect=fake):
            _run(cloud_agent.invoke_cloud_agents(
                "ws1", _event(["agent-a", "__no_response__"]),
            ))
        assert calls == ["agent-a"]

    def test_concurrency_is_capped(self):
        current = 0
        peak = 0
        calls = []

        async def fake(workspace_id, event_data, name, depth):
            nonlocal current, peak
            current += 1
            peak = max(peak, current)
            await asyncio.sleep(0.005)
            current -= 1
            calls.append(name)

        names = [f"agent-{i}" for i in range(6)]
        with patch.object(config, "CLOUD_AGENT_MAX_CONCURRENCY", 2), \
                patch.object(cloud_agent, "_invoke_guarded", side_effect=fake):
            _run(cloud_agent.invoke_cloud_agents("ws1", _event(names)))

        assert sorted(calls) == sorted(names), "every target must still be invoked"
        assert peak <= 2, f"concurrency exceeded the cap (peak={peak})"

    def test_depth_limit_skips_all(self):
        mock = MagicMock()
        with patch.object(cloud_agent, "_invoke_guarded", mock):
            _run(cloud_agent.invoke_cloud_agents(
                "ws1", _event(["agent-a"], depth=config.CLOUD_AGENT_MAX_DEPTH),
            ))
        mock.assert_not_called()
