"""
Platform respond tests for NanoClaw agent.

Tests that a NanoClaw agent connected to a workspace can receive
a message via the workspace API. Verifies the message infrastructure
works end-to-end (send message -> poll -> message appears).

When LLM credentials are available (LLM_API_KEY / OPENAI_API_KEY),
also tests that the agent actually generates a response via the
direct OpenAI-compatible API.

Run:
    pytest tests/platform/respond/test_nanoclaw.py -v
"""

import asyncio
import shutil
import time
import uuid

import pytest

from tests.platform.conftest import (
    run_openagents, safe_print,
    agent_config, workspace_endpoint, has_credentials,
)


AGENT_TYPE = "nanoclaw"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)
ENDPOINT = workspace_endpoint()
HAS_LLM_CREDENTIALS = has_credentials(AGENT_TYPE)


@pytest.fixture()
def workspace_env():
    """Create a workspace via the Python API and clean up after."""
    from openagents.client.workspace_client import WorkspaceClient

    agent_name = f"ci-nclaw-{uuid.uuid4().hex[:8]}"
    ws_name = f"ws-{agent_name}"
    client = WorkspaceClient(endpoint=ENDPOINT)

    ws = asyncio.run(
        client.create_workspace(name=ws_name, agent_name=agent_name, agent_type=AGENT_TYPE)
    )

    yield {
        "agent_name": agent_name,
        "ws_name": ws_name,
        "workspace_id": ws.workspace_id,
        "token": ws.token,
        "channel_name": ws.channel_name,
        "slug": ws.slug,
        "client": client,
    }

    run_openagents("remove", agent_name, timeout=10, stdin_text="y\n")


class TestNanoClawRespond:
    """Test sending messages to a workspace with NanoClaw."""

    def test_send_message_to_workspace(self, workspace_env):
        """Send a message to the workspace via the API — should succeed."""
        env = workspace_env
        client = env["client"]
        msg_content = f"Hello from CI test {uuid.uuid4().hex[:8]}"

        result = asyncio.run(
            client.send_message(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                content=msg_content,
                sender_type="human",
                sender_name="ci-tester",
            )
        )

        assert result is not None, "send_message returned None"
        assert result.get("messageId") or result.get("id"), (
            f"No message ID in response: {result}"
        )

    def test_message_appears_in_channel(self, workspace_env):
        """After sending, the message should appear when polling the channel."""
        env = workspace_env
        client = env["client"]
        msg_content = f"Poll test {uuid.uuid4().hex[:8]}"

        asyncio.run(
            client.send_message(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                content=msg_content,
                sender_type="human",
                sender_name="ci-tester",
            )
        )

        messages = asyncio.run(
            client.poll_messages(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                limit=10,
            )
        )

        found = any(
            msg_content in (m.get("content", "") or "")
            for m in messages
        )
        assert found, (
            f"Message '{msg_content}' not found in channel.\n"
            f"Got {len(messages)} messages: "
            f"{[m.get('content', '')[:50] for m in messages]}"
        )

    def test_start_agent_with_workspace(self, workspace_env):
        """Start the agent and join it to the existing workspace."""
        env = workspace_env

        result = run_openagents(
            "create", AGENT_TYPE,
            "--name", env["agent_name"],
            "--join-workspace", env["token"],
            "--no-browser",
            timeout=60,
            stdin_text="y\n",
        )
        assert result.returncode == 0, (
            f"Failed to start and join workspace "
            f"(exit {result.returncode}).\n"
            f"stdout:\n{result.stdout[-500:]}\n"
            f"stderr:\n{result.stderr[-500:]}"
        )

    def test_send_message_with_agent_running(self, workspace_env):
        """With agent running, send a message and verify it's received."""
        env = workspace_env
        client = env["client"]

        run_openagents(
            "create", AGENT_TYPE,
            "--name", env["agent_name"],
            "--join-workspace", env["token"],
            "--no-browser",
            timeout=60,
            stdin_text="y\n",
        )

        msg_content = f"Agent test {uuid.uuid4().hex[:8]}"

        asyncio.run(
            client.send_message(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                content=msg_content,
                sender_type="human",
                sender_name="ci-tester",
            )
        )

        messages = asyncio.run(
            client.poll_messages(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                limit=20,
            )
        )

        found = any(
            msg_content in (m.get("content", "") or "")
            for m in messages
        )
        assert found, (
            f"Message not found in channel after sending with agent running.\n"
            f"Got {len(messages)} messages."
        )

    @pytest.mark.skipif(
        not HAS_LLM_CREDENTIALS,
        reason="LLM credentials not available (set LLM_API_KEY or OPENAI_API_KEY)",
    )
    def test_agent_responds_to_message(self, workspace_env):
        """Send a message and verify NanoClaw generates a real LLM response.

        Uses direct API mode — calls the OpenAI-compatible chat completions
        endpoint with the model configured in tests/platform/config.yaml.
        """
        env = workspace_env
        client = env["client"]

        start_result = run_openagents(
            "create", AGENT_TYPE,
            "--name", env["agent_name"],
            "--join-workspace", env["token"],
            "--no-browser",
            timeout=60,
            stdin_text="y\n",
        )
        assert start_result.returncode == 0, (
            f"Failed to start agent (exit {start_result.returncode}).\n"
            f"stderr: {start_result.stderr[-500:]}"
        )

        time.sleep(15)

        msg_content = f"Say hello in exactly one sentence. Test ID: {uuid.uuid4().hex[:8]}"

        asyncio.run(
            client.send_message(
                workspace_id=env["workspace_id"],
                channel_name=env["channel_name"],
                token=env["token"],
                content=msg_content,
                sender_type="human",
                sender_name="ci-tester",
            )
        )

        agent_response = None
        messages = []
        for attempt in range(24):
            time.sleep(5)
            messages = asyncio.run(
                client.poll_messages(
                    workspace_id=env["workspace_id"],
                    channel_name=env["channel_name"],
                    token=env["token"],
                    limit=50,
                )
            )

            for m in messages:
                if (
                    m.get("senderType") == "agent"
                    and m.get("messageType", "chat") == "chat"
                    and m.get("content", "").strip()
                ):
                    agent_response = m
                    break

            if agent_response:
                break

            safe_print(f"  Attempt {attempt + 1}/24: no agent response yet...")

        assert agent_response is not None, (
            f"Agent did not respond within 120 seconds.\n"
            f"Sent: '{msg_content}'\n"
            f"Got {len(messages)} messages total."
        )

        response_content = agent_response.get("content", "")
        safe_print(f"  Agent responded: {response_content[:200]}")

        assert len(response_content.strip()) > 5, (
            f"Agent response too short: '{response_content}'"
        )


class TestNanoClawRespondReport:
    """Collect environment info for the test report."""

    def test_report_environment(self, os_platform, openagents_version):
        """Log environment details."""
        binary_path = shutil.which(BINARY_NAME)
        report = {
            "platform": os_platform,
            "openagents_version": openagents_version,
            "agent_binary": binary_path or "(direct API mode)",
            "llm_credentials": "available" if HAS_LLM_CREDENTIALS else "not set",
            "model": _cfg.get("model", "not configured"),
        }
        for k, v in report.items():
            safe_print(f"  {k}: {v}")
