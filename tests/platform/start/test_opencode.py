"""
Platform start tests for OpenCode agent.

Tests that `openagents create opencode` can launch the agent daemon.

Run:
    pytest tests/platform/start/test_opencode.py -v
"""

import shutil
import time

import pytest

from tests.platform.conftest import (
    run_openagents,
    safe_print,
    is_daemon_running_with_agents,
    agent_config,
)


AGENT_NAME = "opencode"
_cfg = agent_config(AGENT_NAME)
BINARY_NAME = _cfg.get("binary", AGENT_NAME)

pytestmark = pytest.mark.skipif(
    is_daemon_running_with_agents(),
    reason="Skipped: daemon is running with active agents — these tests would kill it",
)


@pytest.fixture(autouse=True)
def cleanup_agent():
    yield
    run_openagents("remove", AGENT_NAME, timeout=10, stdin_text="y\n")


class TestOpenCodeStart:
    """Test starting OpenCode via `openagents create opencode`."""

    def test_agent_installed(self):
        assert shutil.which(BINARY_NAME) is not None, (
            f"'{BINARY_NAME}' not on PATH. "
            f"Run install tests first: pytest tests/platform/install/test_opencode.py"
        )

    def test_openagents_start(self):
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


class TestOpenCodeStartReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path,
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
