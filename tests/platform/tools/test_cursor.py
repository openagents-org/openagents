"""
Platform tool execution tests for Cursor agent.

Tests that workspace tool operations (file upload, list, read, delete)
work correctly via the workspace API.

Run:
    pytest tests/platform/tools/test_cursor.py -v
"""

import asyncio
import shutil
import uuid

import pytest

from tests.platform.conftest import (
    safe_print,
    agent_config, workspace_endpoint,
)


AGENT_TYPE = "cursor"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)
ENDPOINT = workspace_endpoint()


@pytest.fixture()
def workspace_env():
    """Create a workspace via the Python API and clean up after."""
    from openagents.client.workspace_client import WorkspaceClient

    agent_name = f"ci-cursor-{uuid.uuid4().hex[:8]}"
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


class TestCursorTools:
    """Test workspace tool operations for Cursor."""

    def test_upload_file(self, workspace_env):
        """Upload a file to the workspace."""
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
        assert result.get("file_id") or result.get("id"), (
            f"No file ID in response: {result}"
        )

    def test_list_files(self, workspace_env):
        """List files in the workspace after uploading one."""
        env = workspace_env
        client = env["client"]

        asyncio.run(
            client.upload_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                filename="list-test.txt",
                content=b"list test content",
                content_type="text/plain",
                source=f"openagents:{env['agent_name']}",
            )
        )

        files = asyncio.run(
            client.list_files(
                workspace_id=env["workspace_id"],
                token=env["token"],
            )
        )

        assert isinstance(files, (list, dict)), f"Unexpected type: {type(files)}"
        file_list = files if isinstance(files, list) else files.get("files", [])
        assert len(file_list) > 0, "No files found after upload"

    def test_upload_and_read_file(self, workspace_env):
        """Upload a file and read it back — content should match."""
        env = workspace_env
        client = env["client"]
        original_content = f"Read test {uuid.uuid4().hex[:8]}"
        filename = "read-test.txt"

        upload_result = asyncio.run(
            client.upload_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                filename=filename,
                content=original_content.encode("utf-8"),
                content_type="text/plain",
                source=f"openagents:{env['agent_name']}",
            )
        )

        file_id = upload_result.get("file_id") or upload_result.get("id")
        assert file_id, f"No file_id in upload result: {upload_result}"

        content = asyncio.run(
            client.read_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                file_id=file_id,
            )
        )

        assert original_content.encode("utf-8") in content or original_content in content.decode("utf-8", errors="replace"), (
            f"Content mismatch. Expected '{original_content}', got: {content[:200]}"
        )

    def test_delete_file(self, workspace_env):
        """Upload a file and delete it."""
        env = workspace_env
        client = env["client"]

        upload_result = asyncio.run(
            client.upload_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                filename="delete-test.txt",
                content=b"delete me",
                content_type="text/plain",
                source=f"openagents:{env['agent_name']}",
            )
        )

        file_id = upload_result.get("file_id") or upload_result.get("id")
        assert file_id

        result = asyncio.run(
            client.delete_file(
                workspace_id=env["workspace_id"],
                token=env["token"],
                file_id=file_id,
            )
        )
        assert result is not None


class TestCursorToolsReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details."""
        safe_print(f"  platform: {os_platform}")
        safe_print(f"  openagents_version: {openagents_version}")
        safe_print(f"  agent_binary: {shutil.which(BINARY_NAME)}")
