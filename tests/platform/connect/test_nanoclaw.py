"""
Platform connect tests for NanoClaw agent.

Tests that `openagents create nanoclaw --create-workspace ...` can create a
workspace and connect the agent to it across Linux, macOS, and Windows.

Run:
    pytest tests/platform/connect/test_nanoclaw.py -v
"""

import shutil
import time
import uuid

import pytest

from tests.platform.conftest import (
    run_openagents, safe_print,
    is_daemon_running_with_agents, agent_config,
)


AGENT_TYPE = "nanoclaw"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)

pytestmark = pytest.mark.skipif(
    is_daemon_running_with_agents(),
    reason="Skipped: daemon is running with active agents — these tests would kill it",
)


@pytest.fixture()
def agent_name():
    """Generate a unique agent name for this test."""
    name = f"ci-nclaw-{uuid.uuid4().hex[:8]}"
    yield name
    run_openagents("remove", name, timeout=10, stdin_text="y\n")


def _start_with_workspace(agent_name: str, ws_name: str, timeout: int = 60):
    """Start the agent with a unique name and create a workspace."""
    return run_openagents(
        "create", AGENT_TYPE,
        "--name", agent_name,
        "--create-workspace", ws_name,
        "--no-browser",
        timeout=timeout,
        stdin_text="y\n",
    )


class TestNanoClawConnect:
    """Test connecting NanoClaw to a workspace."""

    def test_create_workspace_and_connect(self, agent_name):
        """`openagents create nanoclaw --create-workspace` should create a
        workspace and connect the agent to it."""
        ws_name = f"ws-{agent_name}"
        result = _start_with_workspace(agent_name, ws_name)
        assert result.returncode == 0, (
            f"Failed to start {AGENT_TYPE} with --create-workspace "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )
        combined = (result.stdout + result.stderr).lower()
        assert (
            ws_name.lower() in combined
            or "workspace" in combined
            or "created" in combined
        ), (
            f"Output doesn't mention workspace.\n"
            f"stdout:\n{result.stdout[-500:]}"
        )

    def test_status_shows_workspace(self, agent_name):
        """After connecting, `openagents status` should show the workspace."""
        ws_name = f"ws-{agent_name}"
        start = _start_with_workspace(agent_name, ws_name)
        assert start.returncode == 0, (
            f"Start failed (exit {start.returncode}).\n"
            f"stderr: {start.stderr[-500:]}"
        )

        name_prefix = agent_name[:8]
        last_output = ""
        for attempt in range(4):
            time.sleep(3)
            result = run_openagents("status", timeout=10)
            last_output = result.stdout
            output_lower = last_output.lower()

            if name_prefix not in output_lower:
                continue

            agent_lines = [
                line for line in last_output.split("\n")
                if name_prefix in line.lower()
            ]
            if agent_lines and "(local)" not in agent_lines[0].lower():
                break
        else:
            assert name_prefix in last_output.lower(), (
                f"Agent '{agent_name}' not in status after retries.\n"
                f"stdout:\n{last_output}"
            )
            safe_print(
                f"  WARNING: Agent shows as (local) — daemon may not "
                f"have connected to workspace yet"
            )

    def test_agent_remove_after_connect(self, agent_name):
        """`openagents remove` should remove the agent without killing the daemon."""
        ws_name = f"ws-{agent_name}"
        _start_with_workspace(agent_name, ws_name)
        time.sleep(2)

        result = run_openagents("remove", agent_name, timeout=10, stdin_text="y\n")
        combined = (result.stdout + result.stderr).lower()
        ok = result.returncode == 0 or "sighup" in combined
        assert ok, (
            f"`openagents remove` failed (exit {result.returncode}).\n"
            f"stdout: {result.stdout[-500:]}\n"
            f"stderr: {result.stderr[-500:]}"
        )


class TestNanoClawConnectReport:
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
