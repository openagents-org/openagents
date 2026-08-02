# -*- coding: utf-8 -*-
"""
Tests for the requirement-clarification phase gate.

The gate exists to stop a builder agent from being handed the floor — and
starting to implement — while the requirement is still being clarified. It
runs after whatever the thread's orchestration mode decided, so these tests
drive `_handle_message_posted` end-to-end for the deterministic modes and
`_apply_phase_gate` directly for the unit-level rules.
"""

import asyncio

import pytest

from app.models import Channel, ChannelMember, Workspace, WorkspaceMember
from app.mods.workspace_mod import (
    PHASE_BUILDING,
    PHASE_CLARIFYING,
    PHASE_OPEN,
    _apply_phase_gate,
    _handle_message_posted,
    _phase_gatekeepers,
    _phase_router_block,
)
from openagents.core.onm_events import Event
from openagents.core.onm_mods import PipelineContext


def _make_event(source: str, content: str, target: str = "channel/session-test") -> Event:
    return Event(
        type="workspace.message.posted",
        source=source,
        target=target,
        payload={"content": content, "message_type": "chat"},
        metadata={},
    )


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture
def gated_workspace(db):
    """PM (master + phase owner) and RD in one clarifying channel."""
    ws = Workspace(name="Gate WS", slug="gate-ws", password_hash="test-token")
    db.add(ws)
    db.flush()

    db.add(WorkspaceMember(workspace_id=ws.id, agent_name="pm", role="master", status="online"))
    db.add(WorkspaceMember(workspace_id=ws.id, agent_name="rd", role="member", status="online"))
    db.add(WorkspaceMember(workspace_id=ws.id, agent_name="qa", role="member", status="online"))
    db.flush()

    ch = Channel(
        workspace_id=ws.id,
        name="session-test",
        master_agent="pm",
        phase=PHASE_CLARIFYING,
        phase_owner="pm",
        orchestration_mode="master",
        status="active",
    )
    db.add(ch)
    db.flush()
    for name in ("pm", "rd", "qa"):
        db.add(ChannelMember(channel_id=ch.id, agent_name=name))
    db.flush()
    db.refresh(ch)
    return {"workspace": ws, "channel": ch}


class TestGatekeepers:
    def test_owner_first_then_master(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase_owner = "qa"
        assert _phase_gatekeepers(ch) == ["qa", "pm"]

    def test_owner_falls_back_to_master(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase_owner = None
        assert _phase_gatekeepers(ch) == ["pm"]

    def test_no_owner_no_master_is_inert(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase_owner = None
        ch.master_agent = None
        assert _phase_gatekeepers(ch) == []
        event = _make_event("human:user", "build me a thing")
        # Nothing to hand the floor to — routing must pass through untouched
        # rather than swallow the message.
        assert _apply_phase_gate(event, ch, ["rd"], []) == (["rd"], {})


class TestApplyPhaseGate:
    def test_open_phase_is_a_noop(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase = PHASE_OPEN
        event = _make_event("human:user", "build me a thing")
        assert _apply_phase_gate(event, ch, ["rd"], []) == (["rd"], {})

    def test_building_phase_is_a_noop(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase = PHASE_BUILDING
        event = _make_event("human:user", "build me a thing")
        assert _apply_phase_gate(event, ch, ["rd"], []) == (["rd"], {})

    def test_unmentioned_builder_is_redirected_to_the_owner(self, db, gated_workspace):
        """The reported bug: the router picks RD on topic match while the
        requirement is still being clarified."""
        ch = gated_workspace["channel"]
        event = _make_event("human:user", "I want a feature that syncs orders")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], [])
        assert targets == ["pm"]
        assert modes == {}

    def test_mentioned_builder_is_kept_but_downgraded_to_plan(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        event = _make_event("human:user", "@rd is this feasible at all?")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], ["rd"])
        assert targets == ["rd"]
        assert modes == {"rd": "plan"}

    def test_owner_delegating_by_mention_gets_plan_mode(self, db, gated_workspace):
        """PM consulting RD mid-clarification must not start implementation."""
        ch = gated_workspace["channel"]
        event = _make_event("openagents:pm", "@rd how long would the sync take?")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], ["rd"])
        assert targets == ["rd"]
        assert modes == {"rd": "plan"}

    def test_gatekeeper_target_passes_through(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        event = _make_event("openagents:rd", "here's my read on feasibility")
        assert _apply_phase_gate(event, ch, ["pm"], []) == (["pm"], {})

    def test_owner_own_message_does_not_self_loop(self, db, gated_workspace):
        """Everything dropped and the owner is the sender → end the turn
        instead of routing the owner back to itself."""
        ch = gated_workspace["channel"]
        event = _make_event("openagents:pm", "so, a couple of questions for you")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], [])
        assert targets == []
        assert modes == {}

    def test_second_gatekeeper_takes_over_when_owner_is_the_sender(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase_owner = "qa"
        event = _make_event("openagents:qa", "still gathering requirements")
        targets, _ = _apply_phase_gate(event, ch, ["rd"], [])
        assert targets == ["pm"]

    def test_mention_of_an_untargeted_agent_does_not_add_it(self, db, gated_workspace):
        """`mentions` only whitelists agents the mode already targeted — the
        gate narrows routing, it never widens it."""
        ch = gated_workspace["channel"]
        event = _make_event("human:user", "@qa what do you think about rd's plan?")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], ["qa"])
        assert targets == ["pm"]
        assert modes == {}


class TestRouterPromptBlock:
    def test_block_names_the_owner_when_clarifying(self, db, gated_workspace):
        block = _phase_router_block(gated_workspace["channel"])
        assert "CLARIFYING" in block
        assert "pm" in block

    def test_block_is_empty_when_not_clarifying(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase = PHASE_OPEN
        assert _phase_router_block(ch) == ""

    def test_block_is_empty_without_gatekeepers(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ch.phase_owner = None
        ch.master_agent = None
        assert _phase_router_block(ch) == ""


class TestEndToEnd:
    """Through `_handle_message_posted` in master mode (no LLM involved)."""

    def test_master_mode_delegation_to_builder_is_plan_gated(self, db, gated_workspace):
        ws = gated_workspace["workspace"]
        event = _make_event("openagents:pm", "@rd please start on the sync module")
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="openagents:pm", db=db, workspace=ws,
        )
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata["target_agents"] == ["rd"]
        assert out.metadata["target_modes"] == {"rd": "plan"}
        assert out.metadata["phase"] == PHASE_CLARIFYING
        assert out.metadata["phase_owner"] == "pm"

    def test_human_message_reaches_the_owner(self, db, gated_workspace):
        ws = gated_workspace["workspace"]
        event = _make_event("human:user", "I need an order sync feature")
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata["target_agents"] == ["pm"]
        assert "target_modes" not in out.metadata

    def test_building_phase_restores_normal_delegation(self, db, gated_workspace):
        ws = gated_workspace["workspace"]
        ch = gated_workspace["channel"]
        ch.phase = PHASE_BUILDING
        db.flush()
        event = _make_event("openagents:pm", "@rd please start on the sync module")
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="openagents:pm", db=db, workspace=ws,
        )
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata["target_agents"] == ["rd"]
        assert "target_modes" not in out.metadata
        assert "phase" not in out.metadata

    def test_gated_thread_never_leaves_a_human_unanswered(self, db, gated_workspace):
        """A human message that would have gone to a builder still gets a
        reply — from the owner."""
        ws = gated_workspace["workspace"]
        ch = gated_workspace["channel"]
        ch.orchestration_mode = "dynamic"
        # No master and no router key → the fallback picks the first
        # participant (pm), who is NOT the gatekeeper here, so the gate has to
        # redirect rather than drop the message.
        ch.master_agent = None
        ch.phase_owner = "qa"
        db.flush()
        event = _make_event("human:user", "write the code for order sync")
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        out = _run(_handle_message_posted(event, ctx))
        assert out.metadata["target_agents"] == ["qa"]
