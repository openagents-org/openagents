"""
Platform tool execution tests for OpenCode agent.

Tests that workspace file operations via the API behave correctly in an
OpenCode-backed workspace.

Run:
    pytest tests/platform/tools/test_opencode.py -v
"""

import asyncio
import shutil
import uuid

import pytest

from tests.platform.conftest import (
    safe_print,
    agent_config,
    workspace_endpoint,
)


AGENT_TYPE = "opencode"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)
ENDPOINT = workspace_endpoint()


@pytest.fixture()
def workspace_env():
    from openagents.client.workspace_client import WorkspaceClient

    agent_name = f"ci-opencode-{uuid.uuid4().hex[:8]}"
    ws_name = f"ws-{agent_name}"
    client = WorkspaceClient(endpoint=ENDPOINT)

    ws = asyncio.run(
        client.create_workspace(name=ws_name, agent_name=agent_name, agent_type=AGENT_TYPE)
    )

    yield {
        "agent_name": agent_name,
        "workspace_id": ws.workspace_id,
        "token": ws.token,
        "channel_name": ws.channel_name,
        "client": client,
    }


class TestOpenCodeTools:
    """Test workspace tool operations for OpenCode."""

    def test_upload_file(self, workspace_env):
        env = workspace_env
        client = env["client"]
        content = b"Hello from CI test"
        filename = f"test-{uuid.uuid4().hex[:8]}.txt"

        result = asyncio.run(
            client.upload_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                filename=filename,
                content=content,
                content_type="text/plain",
                source=f"openagents:{env['agent_name']}",
                channel_name=env["channel_name"],
            )
        )

        assert result is not None, "upload_file returned None"
        assert result.get("file_id") or result.get("id")

    def test_upload_and_read_file(self, workspace_env):
        env = workspace_env
        client = env["client"]
        original_content = f"Read test {uuid.uuid4().hex[:8]}"

        upload_result = asyncio.run(
            client.upload_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                filename="read-test.txt",
                content=original_content.encode("utf-8"),
                content_type="text/plain",
                source=f"openagents:{env['agent_name']}",
            )
        )

        file_id = upload_result.get("file_id") or upload_result.get("id")
        assert file_id

        content = asyncio.run(
            client.read_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                file_id=file_id,
            )
        )
        content_text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else str(content)
        assert original_content in content_text


class TestOpenCodeToolsReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        safe_print(f"  platform: {os_platform}")
        safe_print(f"  openagents_version: {openagents_version}")
        safe_print(f"  agent_binary: {shutil.which(BINARY_NAME)}")
