# -*- coding: utf-8 -*-
"""
Tests for the LLM-routed multi-agent orchestration.

Tests the _route_with_llm function with mocked LLM responses.
"""

import asyncio
import pytest
from unittest.mock import patch, MagicMock

from app.models import Channel, ChannelMember, WorkspaceMember, Workspace
from app.mods.workspace_mod import _route_with_llm
from openagents.core.onm_events import Event


def _make_event(source: str, target: str, content: str, message_type: str = "chat") -> Event:
    return Event(
        type="workspace.message.posted",
        source=source,
        target=target,
        payload={"content": content, "message_type": message_type},
        metadata={},
    )


def _mock_anthropic_response(text: str):
    mock_content = MagicMock()
    mock_content.text = text
    mock_response = MagicMock()
    mock_response.content = [mock_content]
    return mock_response


def _mock_openai_response(text: str):
    mock_message = MagicMock()
    mock_message.content = text
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


@pytest.fixture
def multi_agent_workspace(db):
    """Set up a workspace with two agents in a channel."""
    ws = Workspace(name="Test WS", slug="test-ws", password_hash="test-token")
    db.add(ws)
    db.flush()

    db.add(WorkspaceMember(workspace_id=ws.id, agent_name="agent-master", role="master", status="online"))
    db.add(WorkspaceMember(workspace_id=ws.id, agent_name="agent-worker", role="member", status="online"))
    db.flush()

    ch = Channel(workspace_id=ws.id, name="session-test", master_agent="agent-master", status="active")
    db.add(ch)
    db.flush()

    db.add(ChannelMember(channel_id=ch.id, agent_name="agent-master"))
    db.add(ChannelMember(channel_id=ch.id, agent_name="agent-worker"))
    db.flush()

    db.refresh(ch)
    return {"workspace": ws, "channel": ch}


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestRouteWithLLM:
    """Tests for _route_with_llm with Anthropic provider."""

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_router_next_agent(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("next:agent-worker")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "@agent-worker please do this")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == ["agent-worker"]

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_router_stop(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("stop")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test",
                            "Here's a summary of what @agent-worker found: everything looks good.")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == []

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_router_multiple_agents_picks_first(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        """When the LLM returns comma-separated agents, only the first is used."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("next:agent-master,agent-worker")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "Both agents need to act")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == ["agent-master"]

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_router_unknown_agent_filtered(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("next:agent-unknown")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "delegate to someone")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == []

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_router_api_failure_returns_stop(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("API down")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "test message")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == []

    @patch("app.mods.workspace_mod._get_router_api_key", return_value="")
    def test_router_no_api_key_returns_stop(self, _mock_key, db, multi_agent_workspace):
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "test")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == []


class TestRouteWithOpenAI:
    """Tests for _route_with_llm with OpenAI provider."""

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="gpt-4o-mini")
    def test_openai_router_next_agent(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_openai_response("next:agent-worker")
        mock_get_client.return_value = (mock_client, "openai")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "delegate to worker")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == ["agent-worker"]

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="gpt-4o-mini")
    def test_openai_router_stop(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_openai_response("stop")
        mock_get_client.return_value = (mock_client, "openai")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "Final summary here.")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == []
