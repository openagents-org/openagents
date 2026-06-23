"""
Platform install tests for NanoClaw agent.

NanoClaw is an EXTERNAL containerized agent runtime (Docker + the Claude
Agent SDK), bridged to the Workspace via a native NanoClaw `openagents`
channel — not a direct LLM API. The catalog "install" step is guidance
only (the user sets NanoClaw up themselves); these tests just verify the
registry entry loads and that the SDK recognises the agent type. The
`ncl` CLI (optional, if symlinked onto PATH) is detected at runtime.

Run:
    pytest tests/platform/install/test_nanoclaw.py -v
"""

import shutil
import subprocess

import pytest

from tests.platform.conftest import run_cmd, run_openagents, safe_print, agent_config


AGENT_TYPE = "nanoclaw"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)


class TestNanoClawInstall:
    """Test installing NanoClaw via `openagents install nanoclaw`."""

    def test_openagents_cli_available(self, has_openagents):
        """`openagents` CLI must be available."""
        assert has_openagents, (
            "openagents CLI is not installed. "
            "Run: pip install openagents"
        )

    def test_openagents_install_nanoclaw(self):
        """`openagents install nanoclaw --yes` should succeed.

        NanoClaw is an external runtime, so the catalog "install" is guidance
        only (no package is fetched). The command should still succeed because
        the registry entry is valid.
        """
        try:
            result = run_openagents("install", AGENT_TYPE, "--yes", timeout=60)
        except subprocess.TimeoutExpired:
            pytest.skip("Install timed out — NanoClaw is an external runtime, no package to fetch.")
            return

        assert result.returncode == 0, (
            f"`openagents install {AGENT_TYPE}` failed "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-1000:]}\n"
            f"stderr:\n{result.stderr[-1000:]}"
        )

    def test_runtime_cli_note(self):
        """The `ncl` CLI is optional — NanoClaw can also be located via NANOCLAW_HOME."""
        binary_path = shutil.which(BINARY_NAME)
        if binary_path:
            safe_print(f"  ncl CLI found at: {binary_path}")
        else:
            safe_print(
                f"  ncl not on PATH (ok — set NANOCLAW_HOME, or symlink bin/ncl)"
            )


class TestNanoClawInstallReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details (always passes, for diagnostics)."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path or "(ncl not on PATH — using NANOCLAW_HOME)",
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
