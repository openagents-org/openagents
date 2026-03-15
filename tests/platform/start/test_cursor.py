"""
Platform start tests for Cursor agent.

Tests that `openagents create cursor` can launch the agent daemon.
Cursor uses direct API mode so no binary is needed — the adapter
calls the chat completions API directly.

Run:
    pytest tests/platform/start/test_cursor.py -v
"""

import shutil
import time

import pytest

from tests.platform.conftest import (
    run_cmd, run_openagents, safe_print,
    is_daemon_running_with_agents, agent_config,
)


AGENT_NAME = "cursor"
_cfg = agent_config(AGENT_NAME)
BINARY_NAME = _cfg.get("binary", AGENT_NAME)

pytestmark = pytest.mark.skipif(
    is_daemon_running_with_agents(),
    reason="Skipped: daemon is running with active agents — these tests would kill it",
)


@pytest.fixture(autouse=True)
def cleanup_agent():
    """Remove the test agent after each test; daemon stays running."""
    yield
    run_openagents("remove", AGENT_NAME, timeout=10, stdin_text="y\n")


class TestCursorStart:
    """Test starting Cursor via `openagents create cursor`."""

    def test_openagents_start(self):
        """`openagents create cursor` should launch the daemon."""
        result = run_openagents(
            "create", AGENT_NAME, "--name", AGENT_NAME, "--no-browser",
            timeout=30,
            stdin_text="y\n\n",
        )
        assert result.returncode == 0, (
            f"`openagents create {AGENT_NAME}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_daemon_running(self):
        """After start, `openagents status` should show daemon running."""
        run_openagents("create", AGENT_NAME, "--name", AGENT_NAME, "--no-browser", timeout=30, stdin_text="y\n\n")
        time.sleep(2)

        result = run_openagents("status", timeout=10)
        output = result.stdout.lower()
        assert "running" in output or "pid" in output or AGENT_NAME in output, (
            f"`openagents status` does not show daemon running.\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )

    def test_agent_remove(self):
        """`openagents remove` should remove the agent without killing the daemon."""
        run_openagents("create", AGENT_NAME, "--name", AGENT_NAME, "--no-browser", timeout=30, stdin_text="y\n\n")
        time.sleep(2)

        result = run_openagents("remove", AGENT_NAME, timeout=10, stdin_text="y\n")
        combined = (result.stdout + result.stderr).lower()
        ok = (
            result.returncode == 0
            or "not found" in combined
            or "sighup" in combined
        )
        assert ok, (
            f"`openagents remove` failed (exit {result.returncode}).\n"
            f"stdout: {result.stdout[-500:]}\n"
            f"stderr: {result.stderr[-500:]}"
        )


class TestCursorStartReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details (always passes, for diagnostics)."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path or "(direct API mode)",
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
