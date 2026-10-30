# -*- coding: utf-8 -*-
"""
Tests for the LLM-routed multi-agent orchestration.

Tests the _route_with_llm function with mocked LLM responses.
"""

import asyncio
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.models import Channel, ChannelMember, EventRecord, WorkspaceMember, Workspace
from app.mods.workspace_mod import _route_with_llm, _handle_message_posted
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


class TestHumanMentionDeterministicRouting:
    """A human @mention is an explicit addressing decision (#333).

    In dynamic/workflow threads every workspace agent tends to be a channel
    participant (the UI's thread picker adds them by default), so letting the
    LLM router re-decide who a "@name" message is for lets bystanders —
    including agents the user never added to the thread — answer instead.
    The mention must win.
    """

    def _dynamic_thread(self, db, multi_agent_workspace):
        """Reopen the fixture channel as a master-less dynamic thread with
        a third participant the user never meant to talk to."""
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.master_agent = None
        ch.orchestration_mode = "dynamic"
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name="agent-bystander", role="member", status="online"))
        db.add(ChannelMember(channel_id=ch.id, agent_name="agent-bystander"))
        db.flush()
        db.refresh(ch)
        return ws, ch

    @patch("app.mods.workspace_mod._route_with_llm", new_callable=AsyncMock)
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    def test_human_mention_bypasses_llm_router(self, _key, mock_router, db, multi_agent_workspace):
        ws, _ch = self._dynamic_thread(db, multi_agent_workspace)
        mock_router.return_value = ["agent-bystander"]
        event = _make_event("human:user", "channel/session-test", "@agent-worker can you check the logs?")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-worker"]
        mock_router.assert_not_called()

    @patch("app.mods.workspace_mod._route_with_llm", new_callable=AsyncMock)
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    def test_human_multiple_mentions_target_all(self, _key, mock_router, db, multi_agent_workspace):
        ws, _ch = self._dynamic_thread(db, multi_agent_workspace)
        mock_router.return_value = ["agent-bystander"]
        event = _make_event("human:user", "channel/session-test", "@agent-master and @agent-worker please pair on this")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-master", "agent-worker"]
        mock_router.assert_not_called()

    @patch("app.mods.workspace_mod._route_with_llm", new_callable=AsyncMock)
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    def test_human_mention_ignores_unknown_agent_names(self, _key, mock_router, db, multi_agent_workspace):
        """A @token that isn't a workspace member isn't a mention — the
        router still decides."""
        ws, _ch = self._dynamic_thread(db, multi_agent_workspace)
        mock_router.return_value = ["agent-worker"]
        event = _make_event("human:user", "channel/session-test", "@nonexistent-style points, who takes this?")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-worker"]
        mock_router.assert_called_once()

    @patch("app.mods.workspace_mod._route_with_llm", new_callable=AsyncMock)
    @patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key")
    def test_agent_mention_still_uses_llm_router(self, _key, mock_router, db, multi_agent_workspace):
        """Only human-authored mentions are deterministic; an agent @mentioning
        a peer mid-message is still a routing decision. (A LEADING @mention
        from an agent is handled earlier by _explicit_agent_targets, so the
        mention here is deliberately not the first token.)"""
        ws, _ch = self._dynamic_thread(db, multi_agent_workspace)
        mock_router.return_value = ["agent-master"]
        event = _make_event("openagents:agent-worker", "channel/session-test", "finished the scan, @agent-master can take the handoff")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-worker", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-master"]
        mock_router.assert_called_once()

    def test_legacy_master_mode_honors_explicit_recipient(self, db, multi_agent_workspace):
        """Retired master mode uses normal addressing semantics."""
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "master"
        db.flush()
        event = _make_event("human:user", "channel/session-test", "@agent-worker can you check the logs?")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["agent-worker"]


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
    def test_proactive_human_message_stays_silent_when_router_says_stop(
        self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace,
    ):
        """The router can identify human conversation and choose no agent."""
        from app.mods.workspace_mod import _handle_message_posted
        from openagents.core.onm_mods import PipelineContext

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response("stop")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        event = _make_event("human:user", "channel/session-test", "how about Julia?")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)

        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["__no_response__"]

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
    def test_proactive_human_message_stays_silent_on_llm_failure(
        self, _mock_model, _mock_key, mock_get_client, db, multi_agent_workspace,
    ):
        """A failed classifier must not arbitrarily interrupt a human conversation."""
        from app.mods.workspace_mod import _handle_message_posted
        from openagents.core.onm_mods import PipelineContext

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("router transient failure")
        mock_get_client.return_value = (mock_client, "anthropic")

        ws = multi_agent_workspace["workspace"]
        event = _make_event("human:user", "channel/session-test", "some message")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)

        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata.get("target_agents") == ["__no_response__"]


class TestStopRestsTheThread:
    """A user Stop must end the thread's agent-to-agent turn-taking.

    Killing the CLI processes is not enough on its own: the router hands one
    agent's message to another, so an agent still finishing its post when the
    stop landed wakes the stopped one back up. That was the reported "Stop
    only works on the second press" in a multi-agent thread.
    """

    @staticmethod
    def _add_event(db, ws, *, type_, source, target, payload, ts):
        db.add(EventRecord(
            id=f"ev-{ts}-{source}",
            network_id=str(ws.id),
            type=type_,
            source=source,
            target=target,
            payload=payload,
            metadata_={},
            timestamp=ts,
        ))
        db.flush()

    def _human_message(self, db, ws, ts, content="go"):
        self._add_event(
            db, ws,
            type_="workspace.message.posted",
            source="human:user",
            target="channel/session-test",
            payload={"content": content, "message_type": "chat"},
            ts=ts,
        )

    def _stop(self, db, ws, ts, channel="session-test"):
        payload = {"action": "stop"}
        if channel is not None:
            payload["channel"] = channel
        self._add_event(
            db, ws,
            type_="workspace.agent.control",
            source="human:user",
            target="openagents:agent-worker",
            payload=payload,
            ts=ts,
        )

    def test_agent_message_after_a_stop_wakes_nobody(self, db, multi_agent_workspace):
        ws = multi_agent_workspace["workspace"]
        self._human_message(db, ws, 1_000)
        self._stop(db, ws, 2_000)

        event = _make_event("openagents:agent-worker", "channel/session-test",
                            "I'll read the channel context first.")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-worker", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))

        assert out.metadata.get("target_agents") == ["__no_response__"]

    def test_a_human_message_lifts_the_rest(self, db, multi_agent_workspace):
        """The user asking for more is the one thing that restarts the thread."""
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "master"
        db.flush()
        self._human_message(db, ws, 1_000)
        self._stop(db, ws, 2_000)
        self._human_message(db, ws, 3_000, content="keep going")

        event = _make_event("openagents:agent-worker", "channel/session-test",
                            "@agent-master here is what I found")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-worker", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))

        assert out.metadata.get("target_agents") == ["agent-master"]

    def test_a_workspace_wide_stop_rests_every_thread(self, db, multi_agent_workspace):
        """The stop-everything path sends no channel; it still rests this one."""
        ws = multi_agent_workspace["workspace"]
        self._human_message(db, ws, 1_000)
        self._stop(db, ws, 2_000, channel=None)

        event = _make_event("openagents:agent-worker", "channel/session-test", "carrying on")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-worker", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))

        assert out.metadata.get("target_agents") == ["__no_response__"]

    def test_a_stop_in_another_channel_is_not_this_thread(self, db, multi_agent_workspace):
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "master"
        db.flush()
        self._human_message(db, ws, 1_000)
        self._stop(db, ws, 2_000, channel="session-elsewhere")

        event = _make_event("openagents:agent-worker", "channel/session-test",
                            "@agent-master here is what I found")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-worker", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))

        assert out.metadata.get("target_agents") == ["agent-master"]

    def test_a_humans_own_message_is_never_gated(self, db, multi_agent_workspace):
        """Pressing Stop and then typing must work — the gate is for agents."""
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "master"
        db.flush()
        self._stop(db, ws, 2_000)

        event = _make_event("human:user", "channel/session-test", "@agent-master kick things off")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))

        assert out.metadata.get("target_agents") == ["agent-master"]

    def test_a_mode_change_is_not_a_stop(self, db, multi_agent_workspace):
        """Only `stop` rests the thread; other control events must not."""
        ws = multi_agent_workspace["workspace"]
        ch = multi_agent_workspace["channel"]
        ch.orchestration_mode = "master"
        db.flush()
        self._human_message(db, ws, 1_000)
        self._add_event(
            db, ws,
            type_="workspace.agent.control",
            source="human:user",
            target="openagents:agent-worker",
            payload={"action": "set_mode", "mode": "plan", "channel": "session-test"},
            ts=2_000,
        )

        event = _make_event("openagents:agent-worker", "channel/session-test",
                            "@agent-master here is what I found")
        ctx = PipelineContext(network_id=str(ws.id), agent_address="openagents:agent-worker", db=db, workspace=ws)
        out = _run(_handle_message_posted(event, ctx))

        assert out.metadata.get("target_agents") == ["agent-master"]


@pytest.mark.parametrize('human_request', [True, False])
@pytest.mark.parametrize('provider,model', [
    ('openai', 'DeepSeek-V4.1-flash'),
    ('openai', 'gpt-4o-mini'),
    ('anthropic', 'claude-haiku-4-5-20251001'),
])
def test_routing_budget_and_provider_specific_thinking(
    db, multi_agent_workspace, monkeypatch, provider, model, human_request,
):
    """Both human classification and agent handoffs use the corrected request."""
    from app.mods import workspace_mod
    client = MagicMock()
    client.chat.completions.create.return_value = _mock_openai_response('next:agent-worker')
    client.messages.create.return_value = _mock_anthropic_response('next:agent-worker')
    monkeypatch.setattr(workspace_mod, '_get_llm_client', lambda: (client, provider))
    monkeypatch.setattr(workspace_mod, '_get_router_api_key', lambda: 'test-key')
    monkeypatch.setattr(workspace_mod, '_get_router_model', lambda: model)
    event = _make_event('human:user' if human_request else 'openagents:agent-master',
                        'channel/session-test', 'Did you open the page?')
    result = _run(_route_with_llm(multi_agent_workspace['channel'], event, db,
                                 multi_agent_workspace['workspace'], allow_human_stop=human_request))
    assert result == ['agent-worker']
    create = client.chat.completions.create if provider == 'openai' else client.messages.create
    kwargs = create.call_args.kwargs
    assert kwargs['max_tokens'] == 256
    if model.startswith('DeepSeek'):
        assert kwargs['extra_body'] == {'thinking': {'type': 'disabled'}}
    else:
        assert 'extra_body' not in kwargs


class TestRoutingConversationEvidence:
    def _capture(self, db, fixture, event, **kwargs):
        client = MagicMock()
        client.messages.create.return_value = _mock_anthropic_response('stop')
        with patch('app.mods.workspace_mod._get_router_api_key', return_value='test'), \
             patch('app.mods.workspace_mod._get_llm_client', return_value=(client, 'anthropic')):
            _run(_route_with_llm(fixture['channel'], event, db, fixture['workspace'], **kwargs))
        return client.messages.create.call_args.kwargs['messages'][0]['content']

    def test_history_filters_noise_before_limit_and_excludes_current_future(self, db, multi_agent_workspace):
        import json
        ws = multi_agent_workspace['workspace']
        def add(id, ts, source='human:alice', kind='chat', metadata=None, target='channel/session-test', network=None):
            db.add(EventRecord(id=id, network_id=network or ws.id, type='workspace.message.posted',
                source=source, target=target, timestamp=ts,
                payload={'content':id,'message_type':kind}, metadata_=metadata or {}))
        for n in range(8):
            add(f'chat-{n}',100+n,source='openagents:agent-worker' if n%2 else 'human:alice')
        for n in range(30):add(f'noise-{n}',200+n,source='openagents:agent-worker',kind='thinking')
        add('recalled',240,metadata={'recalled':True})
        add('assignment',241,metadata={'routing_assignment':{'agent':'agent-worker'}})
        add('system',242,source='system:notice')
        add('other-channel',243,target='channel/other')
        add('other-workspace',244,network='00000000-0000-0000-0000-000000000001')
        event=_make_event('human:alice','channel/session-test','Please continue');event.timestamp=300
        add(event.id,300);add('future',301);db.flush()
        prompt=self._capture(db,multi_agent_workspace,event,allow_human_stop=True)
        evidence=json.JSONDecoder().raw_decode(prompt[prompt.index('{"turns":'):])[0]
        assert [m['content'] for m in evidence['turns']]==[f'chat-{n}' for n in range(2,8)]
        assert evidence['turns'][-1]['sender_type']=='agent'
        assert evidence['follow_up_evidence']['agents_who_spoke_after_request']==['agent-worker']

    def test_historical_question_and_latest_handoff_survive_long_messages(self, db, multi_agent_workspace):
        ws=multi_agent_workspace['workspace']
        db.add(EventRecord(id='prior',network_id=ws.id,type='workspace.message.posted',
            source='openagents:agent-worker',target='channel/session-test',timestamp=1,
            payload={'content':'Background. '*1000+' Please send the requested screenshot.'},metadata_={}))
        db.flush()
        event=_make_event('human:alice','channel/session-test','Details. '*1200+' @agent-worker review the result.')
        prompt=self._capture(db,multi_agent_workspace,event,allow_human_stop=True)
        assert 'Please send the requested screenshot.' in prompt
        assert '@agent-worker review the result.' in prompt
        assert '[...middle omitted...]' in prompt

    def test_agent_turn_has_agent_only_rules(self, db, multi_agent_workspace):
        event=_make_event('openagents:agent-worker','channel/session-test','Done. Would you like me to commit?')
        prompt=self._capture(db,multi_agent_workspace,event)
        assert 'LATEST message, written by AGENT agent-worker' in prompt
        assert 'Default to stop' in prompt
        assert 'Humans expect a reply' not in prompt

    def test_context_targets_cannot_expand_allowed_candidates(self, db, multi_agent_workspace):
        import json
        ws=multi_agent_workspace['workspace']
        db.add(EventRecord(id='request',network_id=ws.id,type='workspace.message.posted',
            source='human:alice',target='channel/session-test',timestamp=1,
            payload={'content':'Investigate this'},metadata_={'target_agents':['agent-worker','agent-master','unknown']}))
        db.flush()
        event=_make_event('human:alice','channel/session-test','Any update?')
        prompt=self._capture(db,multi_agent_workspace,event,allow_human_stop=True,allowed_agents=['agent-worker'])
        evidence=json.JSONDecoder().raw_decode(prompt[prompt.index('{"turns":'):])[0]
        assert evidence['follow_up_evidence']['dispatched_to']==['agent-worker']
