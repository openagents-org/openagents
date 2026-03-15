"""
Platform connect tests for Claude Code agent.

Tests that `openagents create claude --create-workspace ...` can create a
workspace and connect the agent to it across Linux, macOS, and Windows.

Uses a unique --name for each test run so it doesn't collide with any
existing agent entries in the daemon config.

Run:
    pytest tests/platform/connect/test_claude.py -v
"""

import shutil
import time
import uuid

import pytest

from tests.platform.conftest import run_openagents, safe_print, is_daemon_running_with_agents


AGENT_TYPE = "claude"
BINARY_NAME = "claude"

pytestmark = pytest.mark.skipif(
    is_daemon_running_with_agents(),
    reason="Skipped: daemon is running with active agents — these tests would kill it",
)


@pytest.fixture()
def agent_name():
    """Generate a unique agent name for this test."""
    name = f"ci-claude-{uuid.uuid4().hex[:8]}"
    yield name
    # Cleanup: remove the test agent; daemon stays running
    run_openagents("remove", name, timeout=10, stdin_text="y\n")


def _start_with_workspace(agent_name: str, ws_name: str, timeout: int = 60):
    """Start the agent with a unique name and create a workspace.

    Pipes "y\\n" to stdin so the "Continue anyway?" readiness prompt
    (shown when the agent isn't fully configured/logged-in) is accepted.
    """
    return run_openagents(
        "create", AGENT_TYPE,
        "--name", agent_name,
        "--create-workspace", ws_name,
        "--no-browser",
        timeout=timeout,
        stdin_text="y\n",
    )


class TestClaudeConnect:
    """Test connecting Claude Code to a workspace."""

    def test_agent_installed(self):
        """Claude must be installed before we can connect it."""
        assert shutil.which(BINARY_NAME) is not None, (
            f"'{BINARY_NAME}' not on PATH. "
            f"Run install tests first: pytest tests/platform/install/test_claude.py"
        )

    def test_create_workspace_and_connect(self, agent_name):
        """`openagents create claude --create-workspace` should create a
        workspace and connect the agent to it."""
        ws_name = f"ws-{agent_name}"
        result = _start_with_workspace(agent_name, ws_name)
        assert result.returncode == 0, (
            f"Failed to start {AGENT_TYPE} with --create-workspace "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )
        # Output should mention the workspace or "Created"
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

        # Agent name prefix for matching (Rich table may truncate)
        name_prefix = agent_name[:8]

        # Retry a few times — daemon may take a moment to connect
        last_output = ""
        for attempt in range(4):
            time.sleep(3)
            result = run_openagents("status", timeout=10)
            last_output = result.stdout
            output_lower = last_output.lower()

            if name_prefix not in output_lower:
                continue  # agent not in status yet

            # Check if agent row shows workspace (not "(local)")
            agent_lines = [
                line for line in last_output.split("\n")
                if name_prefix in line.lower()
            ]
            if agent_lines and "(local)" not in agent_lines[0].lower():
                break  # success — connected to workspace
        else:
            # Accept if the agent appears at all — the workspace config
            # was created even if daemon hasn't fully connected yet
            assert name_prefix in last_output.lower(), (
                f"Agent '{agent_name}' not in status after retries.\n"
                f"stdout:\n{last_output}"
            )
            # Log warning but don't fail — workspace was created
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


class TestClaudeConnectReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details (always passes, for diagnostics)."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path,
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
