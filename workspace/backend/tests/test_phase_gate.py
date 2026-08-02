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
from sqlalchemy import delete, select, update

from app.models import Channel, ChannelMember, Workspace, WorkspaceMember
from app.mods.workspace_mod import (
    PHASE_BUILDING,
    PHASE_CLARIFYING,
    PHASE_OPEN,
    _apply_phase_gate,
    _handle_agent_remove,
    _handle_channel_create,
    _handle_channel_leave,
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
        ws = gated_workspace["workspace"]
        ch.phase_owner = "qa"
        assert _phase_gatekeepers(ch, db, ws) == ["qa", "pm"]

    def test_owner_falls_back_to_master(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = None
        assert _phase_gatekeepers(ch, db, ws) == ["pm"]

    def test_no_owner_no_master_is_inert(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = None
        ch.master_agent = None
        assert _phase_gatekeepers(ch, db, ws) == []
        event = _make_event("human:user", "build me a thing")
        # Nothing to hand the floor to: the target is kept so the human gets
        # an answer, but it cannot start building.
        assert _apply_phase_gate(event, ch, ["rd"], [], db, ws) == (["rd"], {"rd": "plan"})


class TestGatekeeperValidation:
    """A gatekeeper that cannot answer must never be routed to — that strands
    the conversation with no reply at all."""

    def test_ghost_owner_is_ignored(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = "typo-agent"
        # Master survives, so the gate keeps working through it.
        assert _phase_gatekeepers(ch, db, ws) == ["pm"]

    def test_unenforceable_gate_answers_but_cannot_build(self, db, gated_workspace):
        """An unenforceable gate must neither eat the message nor let the
        builder loose: the target is kept, but downgraded to plan."""
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = "typo-agent"
        ch.master_agent = None
        event = _make_event("human:user", "write the sync code")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], [], db, ws)
        assert targets == ["rd"]
        assert modes == {"rd": "plan"}

    def test_removed_owner_is_ignored(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = "qa"
        db.execute(
            update(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == ws.id,
                WorkspaceMember.agent_name == "qa",
            )
            .values(status="removed")
        )
        db.flush()
        assert _phase_gatekeepers(ch, db, ws) == ["pm"]

    def test_owner_that_left_the_channel_is_ignored(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = "qa"
        db.execute(
            delete(ChannelMember).where(
                ChannelMember.channel_id == ch.id,
                ChannelMember.agent_name == "qa",
            )
        )
        db.flush()
        db.refresh(ch)
        assert _phase_gatekeepers(ch, db, ws) == ["pm"]

    def test_no_valid_gatekeeper_never_targets_a_ghost(self, db, gated_workspace):
        """The end-to-end shape of the bug: routing must not emit a target
        that no connector will ever pick up."""
        ws = gated_workspace["workspace"]
        ch = gated_workspace["channel"]
        ch.phase_owner = "ghost"
        ch.master_agent = None
        ch.orchestration_mode = "dynamic"
        db.flush()
        event = _make_event("human:user", "I need an order sync feature")
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        out = _run(_handle_message_posted(event, ctx))
        assert "ghost" not in out.metadata["target_agents"]
        assert out.metadata["target_agents"] != ["__no_response__"]
        # Whoever picks it up must still be barred from implementing.
        for name in out.metadata["target_agents"]:
            assert out.metadata["target_modes"][name] == "plan"
        assert out.metadata["phase"] == PHASE_CLARIFYING


class TestOwnerRepair:
    """Membership changes must not leave a gate pointing at somebody gone."""

    def test_removing_the_owner_hands_the_gate_to_the_master(self, db, gated_workspace):
        ws = gated_workspace["workspace"]
        ch = gated_workspace["channel"]
        ch.phase_owner = "qa"
        db.flush()
        event = Event(
            type="network.agent.remove",
            source="human:user",
            target="core",
            payload={"agent_name": "qa"},
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_agent_remove(event, ctx))
        db.refresh(ch)
        assert ch.phase_owner == "pm"
        assert ch.phase == PHASE_CLARIFYING

    def test_removing_the_only_gatekeeper_opens_the_gate(self, db, gated_workspace):
        ws = gated_workspace["workspace"]
        ch = gated_workspace["channel"]
        ch.master_agent = None
        db.flush()
        event = Event(
            type="network.agent.remove",
            source="human:user",
            target="core",
            payload={"agent_name": "pm"},
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_agent_remove(event, ctx))
        db.refresh(ch)
        # Better an honestly open thread than one gated on a removed agent.
        assert ch.phase == PHASE_OPEN
        assert ch.phase_owner is None

    def test_owner_who_is_also_master_leaves_nothing_stale_behind(self, db, gated_workspace):
        """owner == master is the common shape. Opening the gate is not
        enough: a stale master_agent keeps every later message routed at the
        agent that just walked out."""
        ws = gated_workspace["workspace"]
        ch = gated_workspace["channel"]
        event = Event(
            type="network.channel.leave",
            source="human:user",
            target="core",
            payload={"channel": "session-test", "agent_name": "pm"},
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_leave(event, ctx))
        db.refresh(ch)
        assert ch.master_agent is None
        assert ch.phase == PHASE_OPEN
        assert ch.phase_owner is None

        # The next human message must reach somebody who is still here.
        msg = _make_event("human:user", "so where are we?")
        out = _run(_handle_message_posted(
            msg,
            PipelineContext(
                network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
            ),
        ))
        assert "pm" not in out.metadata["target_agents"]
        assert out.metadata["target_agents"] != ["__no_response__"]

    def test_removing_the_master_promotes_a_survivor(self, db, gated_workspace):
        """Guards the query behind the repair: picking the next master over
        several survivors used to raise MultipleResultsFound and abort the
        whole removal."""
        ws = gated_workspace["workspace"]
        event = Event(
            type="network.agent.remove",
            source="human:user",
            target="core",
            payload={"agent_name": "pm"},
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        out = _run(_handle_agent_remove(event, ctx))
        assert out.metadata["new_master"] in ("rd", "qa")

    def test_owner_leaving_the_channel_hands_the_gate_on(self, db, gated_workspace):
        ws = gated_workspace["workspace"]
        ch = gated_workspace["channel"]
        ch.phase_owner = "qa"
        db.flush()
        event = Event(
            type="network.channel.leave",
            source="human:user",
            target="core",
            payload={"channel": "session-test", "agent_name": "qa"},
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_leave(event, ctx))
        db.refresh(ch)
        assert ch.phase_owner == "pm"


class TestChannelCreateGate:
    def test_clarifying_without_a_valid_owner_is_created_open(self, db):
        """Threads from the picker have no master; a gate asked for without
        an owner must not be born in the unenforceable state."""
        ws = Workspace(name="Create WS", slug="create-ws", password_hash="t")
        db.add(ws)
        db.flush()
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name="rd", role="member", status="online"))
        db.flush()
        event = Event(
            type="network.channel.create",
            source="human:user",
            target="core",
            payload={"name": "c-open", "participants": ["rd"], "phase": "clarifying"},
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_create(event, ctx))
        ch = db.execute(
            select(Channel).where(Channel.workspace_id == ws.id, Channel.name == "c-open")
        ).scalar_one()
        assert ch.phase == PHASE_OPEN
        assert ch.phase_owner is None

    def test_ghost_owner_in_the_participants_payload_is_refused(self, db):
        """The participants list is caller-supplied: appearing in it proves
        nothing about the agent existing."""
        ws = Workspace(name="Create WS3", slug="create-ws3", password_hash="t")
        db.add(ws)
        db.flush()
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name="rd", role="member", status="online"))
        db.flush()
        event = Event(
            type="network.channel.create",
            source="human:user",
            target="core",
            payload={
                "name": "c-ghost",
                "participants": ["ghost", "rd"],
                "phase": "clarifying",
                "phase_owner": "ghost",
            },
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_create(event, ctx))
        ch = db.execute(
            select(Channel).where(Channel.workspace_id == ws.id, Channel.name == "c-ghost")
        ).scalar_one()
        assert ch.phase == PHASE_OPEN
        assert ch.phase_owner is None

    def test_owner_outside_the_participants_is_refused(self, db):
        """The owner has to be in the thread it owns — the new-thread dialog
        only offers selected agents, and the backend enforces the same rule."""
        ws = Workspace(name="Create WS5", slug="create-ws5", password_hash="t")
        db.add(ws)
        db.flush()
        for name in ("pm", "rd"):
            db.add(WorkspaceMember(workspace_id=ws.id, agent_name=name, role="member", status="online"))
        db.flush()
        event = Event(
            type="network.channel.create",
            source="human:user",
            target="core",
            payload={
                "name": "c-outsider",
                "participants": ["rd"],          # pm was not selected
                "phase": "clarifying",
                "phase_owner": "pm",
            },
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_create(event, ctx))
        ch = db.execute(
            select(Channel).where(Channel.workspace_id == ws.id, Channel.name == "c-outsider")
        ).scalar_one()
        assert ch.phase == PHASE_OPEN
        assert ch.phase_owner is None

    def test_creating_without_a_phase_is_open(self, db):
        """Unchecking "clarify first" sends no phase at all."""
        ws = Workspace(name="Create WS6", slug="create-ws6", password_hash="t")
        db.add(ws)
        db.flush()
        for name in ("pm", "rd"):
            db.add(WorkspaceMember(workspace_id=ws.id, agent_name=name, role="member", status="online"))
        db.flush()
        event = Event(
            type="network.channel.create",
            source="human:user",
            target="core",
            payload={"name": "c-plain", "participants": ["pm", "rd"]},
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_create(event, ctx))
        ch = db.execute(
            select(Channel).where(Channel.workspace_id == ws.id, Channel.name == "c-plain")
        ).scalar_one()
        assert ch.phase == PHASE_OPEN
        assert ch.phase_owner is None

    def test_gate_is_live_for_the_very_first_message(self, db):
        """The whole point of sending the phase with the create event: there
        must be no window in which the thread exists ungated and the first
        request can be routed to a builder."""
        ws = Workspace(name="Create WS7", slug="create-ws7", password_hash="t")
        db.add(ws)
        db.flush()
        for name in ("pm", "rd"):
            db.add(WorkspaceMember(workspace_id=ws.id, agent_name=name, role="member", status="online"))
        db.flush()
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_create(Event(
            type="network.channel.create",
            source="human:user",
            target="core",
            payload={
                # rd first, so the ungated fallback would pick rd — the
                # assertion below only holds if the gate is already live.
                "name": "c-first",
                "participants": ["rd", "pm"],
                "phase": "clarifying",
                "phase_owner": "pm",
            },
            metadata={},
        ), ctx))

        # No PATCH in between — straight to the opening request.
        first = _make_event(
            "human:user", "build me an order sync feature", target="channel/c-first",
        )
        out = _run(_handle_message_posted(first, ctx))
        assert out.metadata["target_agents"] == ["pm"]
        assert out.metadata["phase"] == PHASE_CLARIFYING
        assert out.metadata["phase_owner"] == "pm"

    def test_removed_owner_at_creation_is_refused(self, db):
        ws = Workspace(name="Create WS4", slug="create-ws4", password_hash="t")
        db.add(ws)
        db.flush()
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name="pm", role="member", status="removed"))
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name="rd", role="member", status="online"))
        db.flush()
        event = Event(
            type="network.channel.create",
            source="human:user",
            target="core",
            payload={
                "name": "c-removed",
                "participants": ["pm", "rd"],
                "phase": "clarifying",
                "phase_owner": "pm",
            },
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_create(event, ctx))
        ch = db.execute(
            select(Channel).where(Channel.workspace_id == ws.id, Channel.name == "c-removed")
        ).scalar_one()
        assert ch.phase == PHASE_OPEN
        assert ch.phase_owner is None

    def test_clarifying_with_a_participant_owner_is_honoured(self, db):
        ws = Workspace(name="Create WS2", slug="create-ws2", password_hash="t")
        db.add(ws)
        db.flush()
        for name in ("pm", "rd"):
            db.add(WorkspaceMember(workspace_id=ws.id, agent_name=name, role="member", status="online"))
        db.flush()
        event = Event(
            type="network.channel.create",
            source="human:user",
            target="core",
            payload={
                "name": "c-gated",
                "participants": ["pm", "rd"],
                "phase": "clarifying",
                "phase_owner": "pm",
            },
            metadata={},
        )
        ctx = PipelineContext(
            network_id=str(ws.id), agent_address="human:user", db=db, workspace=ws,
        )
        _run(_handle_channel_create(event, ctx))
        ch = db.execute(
            select(Channel).where(Channel.workspace_id == ws.id, Channel.name == "c-gated")
        ).scalar_one()
        assert ch.phase == PHASE_CLARIFYING
        assert ch.phase_owner == "pm"


class TestApplyPhaseGate:
    def test_open_phase_is_a_noop(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase = PHASE_OPEN
        event = _make_event("human:user", "build me a thing")
        assert _apply_phase_gate(event, ch, ["rd"], [], db, ws) == (["rd"], {})

    def test_building_phase_is_a_noop(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase = PHASE_BUILDING
        event = _make_event("human:user", "build me a thing")
        assert _apply_phase_gate(event, ch, ["rd"], [], db, ws) == (["rd"], {})

    def test_unmentioned_builder_is_redirected_to_the_owner(self, db, gated_workspace):
        """The reported bug: the router picks RD on topic match while the
        requirement is still being clarified."""
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        event = _make_event("human:user", "I want a feature that syncs orders")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], [], db, ws)
        assert targets == ["pm"]
        assert modes == {}

    def test_mentioned_builder_is_kept_but_downgraded_to_plan(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        event = _make_event("human:user", "@rd is this feasible at all?")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], ["rd"], db, ws)
        assert targets == ["rd"]
        assert modes == {"rd": "plan"}

    def test_owner_delegating_by_mention_gets_plan_mode(self, db, gated_workspace):
        """PM consulting RD mid-clarification must not start implementation."""
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        event = _make_event("openagents:pm", "@rd how long would the sync take?")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], ["rd"], db, ws)
        assert targets == ["rd"]
        assert modes == {"rd": "plan"}

    def test_gatekeeper_target_passes_through(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        event = _make_event("openagents:rd", "here's my read on feasibility")
        assert _apply_phase_gate(event, ch, ["pm"], [], db, ws) == (["pm"], {})

    def test_owner_own_message_does_not_self_loop(self, db, gated_workspace):
        """Everything dropped and the owner is the sender → end the turn
        instead of routing the owner back to itself."""
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        event = _make_event("openagents:pm", "so, a couple of questions for you")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], [], db, ws)
        assert targets == []
        assert modes == {}

    def test_second_gatekeeper_takes_over_when_owner_is_the_sender(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = "qa"
        event = _make_event("openagents:qa", "still gathering requirements")
        targets, _ = _apply_phase_gate(event, ch, ["rd"], [], db, ws)
        assert targets == ["pm"]

    def test_mention_of_an_untargeted_agent_does_not_add_it(self, db, gated_workspace):
        """`mentions` only whitelists agents the mode already targeted — the
        gate narrows routing, it never widens it."""
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        event = _make_event("human:user", "@qa what do you think about rd's plan?")
        targets, modes = _apply_phase_gate(event, ch, ["rd"], ["qa"], db, ws)
        assert targets == ["pm"]
        assert modes == {}


class TestRouterPromptBlock:
    def test_block_names_the_owner_when_clarifying(self, db, gated_workspace):
        block = _phase_router_block(gated_workspace["channel"], db, gated_workspace["workspace"])
        assert "CLARIFYING" in block
        assert "pm" in block

    def test_block_is_empty_when_not_clarifying(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase = PHASE_OPEN
        assert _phase_router_block(ch, db, ws) == ""

    def test_block_is_empty_without_gatekeepers(self, db, gated_workspace):
        ch = gated_workspace["channel"]
        ws = gated_workspace["workspace"]
        ch.phase_owner = None
        ch.master_agent = None
        assert _phase_router_block(ch, db, ws) == ""


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
