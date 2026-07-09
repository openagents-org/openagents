# -*- coding: utf-8 -*-
"""
Tests for the LLM-routed multi-agent orchestration.

Tests the _route_with_llm function with mocked LLM responses.
"""

import asyncio
import pytest
from unittest.mock import patch, MagicMock

from app.models import Channel, ChannelMember, WorkspaceMember, Workspace
from app.mods.workspace_mod import _route_with_llm, _master_targets, _handle_message_posted
from openagents.core.onm_events import Event
from openagents.core.onm_mods import PipelineContext


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
        # Human sender so the first of the comma-list isn't a self-loop.
        event = _make_event("human:user", "channel/session-test", "Both agents need to act")

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

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_router_agent_name_case_insensitive_match(self, _mock_model, _mock_key, mock_get_client, db):
        """Model may return next:julia-robot but the stored agent name is Julia-Robot.
        We must match case-insensitively and return the original-case name."""
        from app.models import Channel, ChannelMember, WorkspaceMember, Workspace
        ws = Workspace(name="case-ws", slug="case-ws", password_hash="t")
        db.add(ws); db.flush()
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name="Julia-Robot", role="master", status="online"))
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name="bary-bot", role="member", status="online"))
        db.flush()
        ch = Channel(workspace_id=ws.id, name="c1", master_agent="Julia-Robot", status="active")
        db.add(ch); db.flush()
        db.add(ChannelMember(channel_id=ch.id, agent_name="Julia-Robot"))
        db.add(ChannelMember(channel_id=ch.id, agent_name="bary-bot"))
        db.flush()
        db.refresh(ch)

        mock_client = MagicMock()
        # Model returns lowercased name (common with OpenAI-compatible endpoints)
        mock_client.messages.create.return_value = _mock_anthropic_response("next:julia-robot")
        mock_get_client.return_value = (mock_client, "anthropic")

        event = _make_event("human:user", "channel/c1", "@Julia-Robot what's up?")
        result = _run(_route_with_llm(ch, event, db, ws))
        # Must canonicalize back to the stored case
        assert result == ["Julia-Robot"]

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_router_rejects_self_loop(self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace):
        """Router must not return the same agent that just spoke; otherwise
        the agent ends up listed as a target for its own message which
        pre-0.2.106 clients then try to respond to."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("next:agent-master")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        # agent-master just sent this message; router must not re-target it
        event = _make_event("openagents:agent-master", "channel/session-test", "some update")

        result = _run(_route_with_llm(ch, event, db, ws))
        assert result == [], "self-loop must be rejected"


class TestMasterMode:
    """Deterministic 'master' orchestration mode — no LLM. Star topology:
    humans and sub-agents route to the master; the master delegates via
    @mention."""

    def test_human_routes_to_master(self, db, multi_agent_workspace):
        ch = multi_agent_workspace["channel"]
        event = _make_event("human:user", "channel/session-test", "please do the thing")
        assert _master_targets(event, ch, []) == ["agent-master"]

    def test_sub_agent_returns_to_master(self, db, multi_agent_workspace):
        ch = multi_agent_workspace["channel"]
        # agent-worker (a sub-agent) reports back → routes to the master hub
        event = _make_event("openagents:agent-worker", "channel/session-test", "here are my results")
        assert _master_targets(event, ch, []) == ["agent-master"]

    def test_master_delegates_via_mention(self, db, multi_agent_workspace):
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test",
                            "@agent-worker please handle this")
        assert _master_targets(event, ch, ["agent-worker"]) == ["agent-worker"]

    def test_master_no_mention_stops(self, db, multi_agent_workspace):
        ch = multi_agent_workspace["channel"]
        # Master answered the human directly (no delegation) → stop
        event = _make_event("openagents:agent-master", "channel/session-test",
                            "Here is the answer directly.")
        assert _master_targets(event, ch, []) == []

    def test_master_self_mention_excluded(self, db, multi_agent_workspace):
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test",
                            "@agent-master note to self")
        assert _master_targets(event, ch, ["agent-master"]) == []

    def test_no_master_returns_empty(self, db, multi_agent_workspace):
        ch = multi_agent_workspace["channel"]
        ch.master_agent = None
        db.flush()
        event = _make_event("human:user", "channel/session-test", "hello")
        assert _master_targets(event, ch, []) == []

    def test_handle_message_posted_master_mode_human(self, db, multi_agent_workspace):
        """End-to-end: mode='master', human message → target the master,
        with no LLM call involved."""
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "master"
        db.flush()
        event = _make_event("human:user", "channel/session-test", "kick things off")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-master"]

    def test_handle_message_posted_master_mode_subagent_returns(self, db, multi_agent_workspace):
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "master"
        db.flush()
        event = _make_event("openagents:agent-worker", "channel/session-test", "done, results attached")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-worker", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-master"]


class TestWorkflowMode:
    """'workflow' mode reuses the LLM router but injects a user-authored
    natural-language collaboration plan into the prompt."""

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_plan_injected_into_prompt(self, _m, _k, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("next:agent-worker")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        plan = "First @agent-worker writes tests, then @agent-master reviews."
        event = _make_event("human:user", "channel/session-test", "start the task")

        result = _run(_route_with_llm(ch, event, db, ws, workflow_instruction=plan))
        assert result == ["agent-worker"]
        # The plan must appear in the prompt sent to the model.
        sent_prompt = mock_client.messages.create.call_args.kwargs["messages"][0]["content"]
        assert plan in sent_prompt
        assert "COLLABORATION PLAN" in sent_prompt

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_dynamic_mode_has_no_plan_block(self, _m, _k, mock_get_client, db, multi_agent_workspace):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("stop")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        event = _make_event("openagents:agent-master", "channel/session-test", "some update")

        _run(_route_with_llm(ch, event, db, ws))  # no workflow_instruction
        sent_prompt = mock_client.messages.create.call_args.kwargs["messages"][0]["content"]
        assert "COLLABORATION PLAN" not in sent_prompt

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_handle_message_posted_workflow_passes_instruction(self, _m, _k, mock_get_client, db, multi_agent_workspace):
        """mode='workflow' → the channel's stored instruction reaches the prompt."""
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("next:agent-worker")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "workflow"
        ch.orchestration_instruction = "Have @agent-worker do the coding first."
        db.flush()
        event = _make_event("human:user", "channel/session-test", "go")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-worker"]
        sent_prompt = mock_client.messages.create.call_args.kwargs["messages"][0]["content"]
        assert "Have @agent-worker do the coding first." in sent_prompt


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


class TestMessagePostedTargetAgents:
    """_handle_message_posted must ALWAYS set target_agents, even when
    routing decides nobody should respond. Otherwise legacy clients
    interpret missing target_agents as 'broadcast to all' and every
    agent in the channel replies at once.
    """

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_human_message_always_routed_even_if_router_says_stop(
        self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace,
    ):
        """A human message must never fall through to the sentinel.
        If the router mistakenly says 'stop' for a human question, the
        safety net routes to the master/fallback so the user gets a reply.
        """
        from app.mods.workspace_mod import _handle_message_posted
        from openagents.core.onm_mods import PipelineContext

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("stop")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        event = _make_event("human:user", "channel/session-test", "how about Julia?")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)

        out = _run(_handle_message_posted(event, ctx))
        # Master is the fallback; must NOT be the sentinel
        assert out.metadata.get("target_agents") == ["agent-master"]

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_agent_message_gets_sentinel_on_stop(
        self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace,
    ):
        """Agent-sourced 'stop' still produces the sentinel (no human to satisfy)."""
        from app.mods.workspace_mod import _handle_message_posted
        from openagents.core.onm_mods import PipelineContext

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("stop")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        event = _make_event("openagents:agent-master", "channel/session-test", "done — here is the final answer.")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-master", db=db, workspace=ws)

        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["__no_response__"]

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_target_agents_set_on_next(
        self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace,
    ):
        from app.mods.workspace_mod import _handle_message_posted
        from openagents.core.onm_mods import PipelineContext

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("next:agent-worker")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        event = _make_event("human:user", "channel/session-test", "agent-worker please help")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)

        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata["target_agents"] == ["agent-worker"]

    @patch("app.mods.workspace_mod._get_llm_client")
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    @patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001")
    def test_human_message_routed_to_fallback_on_llm_failure(
        self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace,
    ):
        """LLM router exception on a human message → fallback target, not sentinel.
        Humans must always get a response, even if routing fails."""
        from app.mods.workspace_mod import _handle_message_posted
        from openagents.core.onm_mods import PipelineContext

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("router transient failure")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        event = _make_event("human:user", "channel/session-test", "some message")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)

        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-master"]
