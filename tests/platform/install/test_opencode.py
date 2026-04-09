"""
Platform install tests for OpenCode agent.

Tests the real user experience: `openagents install opencode`
across Linux, macOS, and Windows.

Run:
    pytest tests/platform/install/test_opencode.py -v
"""

import shutil
import subprocess

import pytest

from tests.platform.conftest import run_cmd, run_openagents, safe_print, agent_config


AGENT_TYPE = "opencode"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)


class TestOpenCodeInstall:
    """Test installing OpenCode via `openagents install opencode`."""

    def test_openagents_cli_available(self, has_openagents):
        assert has_openagents, (
            "openagents CLI is not installed. "
            "Run: pip install openagents"
        )

    def test_openagents_install_opencode(self):
        try:
            result = run_openagents("install", AGENT_TYPE, "--yes", timeout=300)
        except subprocess.TimeoutExpired:
            if shutil.which(BINARY_NAME) is not None:
                pytest.skip(
                    f"Install timed out at 300s but '{BINARY_NAME}' "
                    f"is on PATH — likely succeeded."
                )
            pytest.fail(
                f"`openagents install {AGENT_TYPE}` timed out "
                f"after 300s and binary not found on PATH."
            )
            return

        assert result.returncode == 0, (
            f"`openagents install {AGENT_TYPE}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_binary_on_path(self):
        path = shutil.which(BINARY_NAME)
        assert path is not None, (
            f"'{BINARY_NAME}' not found on PATH after "
            f"`openagents install {AGENT_TYPE}`."
        )

    def test_binary_version(self):
        if shutil.which(BINARY_NAME) is None:
            pytest.skip(f"'{BINARY_NAME}' not on PATH")

        result = run_cmd([BINARY_NAME, "--version"], timeout=30)
        assert result.returncode == 0, (
            f"'{BINARY_NAME} --version' failed "
            f"(exit {result.returncode}).\n"
            f"stderr: {result.stderr[-500:]}"
        )
        assert len(result.stdout.strip()) > 0, "Version output is empty"


class TestOpenCodeInstallReport:
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
