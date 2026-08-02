# -*- coding: utf-8 -*-
"""
Tests for delegation-receipt routing.

A structured receipt (agent chat stamped with in_reply_to + reply_kind) must
be routed deterministically back to the delegating agent, bypassing the LLM
router. Everything that is NOT a valid receipt must fall through to the
existing routing untouched.
"""

import asyncio
import time
import uuid

import pytest
from unittest.mock import patch, MagicMock

from app.models import (
    Channel, ChannelMember, EventRecord, Workspace, WorkspaceMember,
)
from app.mods.workspace_mod import _handle_message_posted
from openagents.core.onm_events import Event
from openagents.core.onm_mods import PipelineContext


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _now_ms() -> int:
    return int(time.time() * 1000)


@pytest.fixture
def ws3(db):
    """Workspace with three agents (a, b, c) in one dynamic channel."""
    ws = Workspace(name="Receipt WS", slug=f"receipt-{uuid.uuid4().hex[:8]}", password_hash="t")
    db.add(ws)
    db.flush()
    for name in ("agent-a", "agent-b", "agent-c"):
        db.add(WorkspaceMember(workspace_id=ws.id, agent_name=name, role="member", status="online"))
    db.flush()
    ch = Channel(workspace_id=ws.id, name="session-r", status="active")
    db.add(ch)
    db.flush()
    for name in ("agent-a", "agent-b", "agent-c"):
        db.add(ChannelMember(channel_id=ch.id, agent_name=name))
    db.flush()
    db.refresh(ch)
    return {"workspace": ws, "channel": ch}


def _delegation_event(db, ws, *, delegated_by="agent-a", delegated_to=("agent-b",),
                      target="channel/session-r", timestamp=None, receipt_from=None) -> EventRecord:
    """Persist a delegation message E1 the way the pipeline would have."""
    meta = {
        "target_agents": list(delegated_to),
        "delegated_by": delegated_by,
        "delegated_to": list(delegated_to),
    }
    if receipt_from is not None:
        meta["receipt_from"] = list(receipt_from)
    rec = EventRecord(
        id=str(uuid.uuid4()),
        network_id=ws.id,
        type="workspace.message.posted",
        source=f"openagents:{delegated_by}",
        target=target,
        payload={"content": f"@{delegated_to[0]} please do X", "message_type": "chat"},
        metadata_=meta,
        timestamp=timestamp if timestamp is not None else _now_ms(),
    )
    db.add(rec)
    db.flush()
    return rec


def _reply(source, content, *, in_reply_to=None, reply_kind=None,
           target="channel/session-r", extra_meta=None) -> Event:
    meta = dict(extra_meta or {})
    if in_reply_to is not None:
        meta["in_reply_to"] = in_reply_to
    if reply_kind is not None:
        meta["reply_kind"] = reply_kind
    return Event(
        type="workspace.message.posted",
        source=source,
        target=target,
        payload={"content": content, "message_type": "chat"},
        metadata=meta,
    )


def _ctx(db, ws) -> PipelineContext:
    return PipelineContext(network_id=str(ws.id), agent_address="x", db=db, workspace=ws)


def _handle(db, ws, event):
    return _run(_handle_message_posted(event, _ctx(db, ws)))


ROUTER_PATCHES = (
    patch("app.mods.workspace_mod._get_router_api_key", return_value="test-key"),
    patch("app.mods.workspace_mod._get_router_model", return_value="claude-haiku-4-5-20251001"),
)


def _with_router(mock_text="stop"):
    """Context manager stack: mocked LLM router returning `mock_text`."""
    mock_content = MagicMock()
    mock_content.text = mock_text
    mock_response = MagicMock()
    mock_response.content = [mock_content]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    client_patch = patch(
        "app.mods.workspace_mod._get_llm_client",
        return_value=(mock_client, "anthropic"),
    )
    return client_patch, mock_client


class TestReceiptHit:
    def test_receipt_routes_to_delegator_without_llm(self, db, ws3):
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        client_patch, mock_client = _with_router()
        with ROUTER_PATCHES[0], ROUTER_PATCHES[1], client_patch:
            out = _handle(db, ws, _reply(
                "openagents:agent-b", "All done, results attached.",
                in_reply_to=e1.id, reply_kind="result",
            ))
        assert out.metadata["target_agents"] == ["agent-a"]
        mock_client.messages.create.assert_not_called()

    def test_receipt_stamps_e1_single_use(self, db, ws3):
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        _handle(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        db.refresh(e1)
        assert e1.metadata_.get("receipt_from") == ["agent-b"]

    def test_all_reply_kinds_accepted(self, db, ws3):
        ws = ws3["workspace"]
        for kind in ("result", "error", "needs_input", "cancelled"):
            e1 = _delegation_event(db, ws)
            out = _handle(db, ws, _reply(
                "openagents:agent-b", "terminal", in_reply_to=e1.id, reply_kind=kind,
            ))
            assert out.metadata["target_agents"] == ["agent-a"], kind

    def test_mention_of_delegator_is_not_reverse_delegation(self, db, ws3):
        """"@agent-a I'm done" must stay a plain receipt — no new delegation."""
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        out = _handle(db, ws, _reply(
            "openagents:agent-b", "@agent-a finished, see results.",
            in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["agent-a"]
        assert "delegated_by" not in out.metadata
        assert "delegated_to" not in out.metadata

    def test_onward_mention_dual_routes(self, db, ws3):
        """Receipt that @mentions a third agent goes to both A and C, and the
        onward hop is marked as a new delegation by B."""
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        out = _handle(db, ws, _reply(
            "openagents:agent-b", "Part one done. @agent-c please take over part two.",
            in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["agent-a", "agent-c"]
        assert out.metadata["delegated_by"] == "agent-b"
        assert out.metadata["delegated_to"] == ["agent-c"]


class TestReceiptRejected:
    """Every rejection must fall through to normal routing (mocked router)."""

    def _stop_routed(self, db, ws, event):
        client_patch, mock_client = _with_router("stop")
        with ROUTER_PATCHES[0], ROUTER_PATCHES[1], client_patch:
            out = _handle(db, ws, event)
        return out, mock_client

    def test_missing_reply_kind(self, db, ws3):
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        out, mock_client = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id,
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]
        mock_client.messages.create.assert_called()

    def test_unknown_reply_kind(self, db, ws3):
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="finished",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_forged_server_owned_metadata_is_stripped(self, db, ws3):
        """A client-submitted delegation chain must be dropped before routing."""
        ws = ws3["workspace"]
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "innocuous text",
            extra_meta={
                "delegated_by": "agent-b",
                "delegated_to": ["agent-a"],
                "receipt_from": ["agent-c"],
            },
        ))
        assert "delegated_by" not in out.metadata
        assert "delegated_to" not in out.metadata
        assert "receipt_from" not in out.metadata

    def test_e1_missing(self, db, ws3):
        ws = ws3["workspace"]
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=str(uuid.uuid4()), reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_cross_channel_reference(self, db, ws3):
        ws = ws3["workspace"]
        e1 = _delegation_event(db, ws, target="channel/session-other")
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_delegated_by_source_mismatch(self, db, ws3):
        """E1 whose source doesn't match its delegated_by is never honoured."""
        ws = ws3["workspace"]
        e1 = _delegation_event(db, ws)
        meta = dict(e1.metadata_)
        meta["delegated_by"] = "agent-c"  # source stays openagents:agent-a
        e1.metadata_ = meta
        db.flush()
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_replier_not_in_delegated_to(self, db, ws3):
        ws = ws3["workspace"]
        e1 = _delegation_event(db, ws, delegated_to=("agent-c",))
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_delegator_left_channel(self, db, ws3):
        """Workspace membership isn't enough — A must still be in the channel."""
        ws, ch = ws3["workspace"], ws3["channel"]
        e1 = _delegation_event(db, ws)
        from sqlalchemy import select
        member = db.execute(
            select(ChannelMember).where(
                ChannelMember.channel_id == ch.id,
                ChannelMember.agent_name == "agent-a",
            )
        ).scalar_one()
        db.delete(member)
        db.flush()
        db.refresh(ch)
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_expired_delegation(self, db, ws3):
        ws = ws3["workspace"]
        stale = _now_ms() - int(48 * 3600 * 1000)  # older than the 24h default TTL
        e1 = _delegation_event(db, ws, timestamp=stale)
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_duplicate_terminal_receipt_suppressed_without_router(self, db, ws3):
        """At-most-once: a duplicate must NOT fall back to the LLM router,
        which could re-select the delegator — it is suppressed outright."""
        ws = ws3["workspace"]
        e1 = _delegation_event(db, ws, receipt_from=("agent-b",))
        client_patch, mock_client = _with_router("next:agent-a")  # router WOULD re-route
        with ROUTER_PATCHES[0], ROUTER_PATCHES[1], client_patch:
            out = _handle(db, ws, _reply(
                "openagents:agent-b", "done again", in_reply_to=e1.id, reply_kind="result",
            ))
        assert out.metadata["target_agents"] == ["__no_response__"]
        mock_client.messages.create.assert_not_called()
        db.refresh(e1)
        assert e1.metadata_["receipt_from"] == ["agent-b"]  # unchanged

    def test_duplicate_receipt_still_honours_onward_mention(self, db, ws3):
        ws = ws3["workspace"]
        e1 = _delegation_event(db, ws, receipt_from=("agent-b",))
        out = _handle(db, ws, _reply(
            "openagents:agent-b", "also @agent-c please verify",
            in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["agent-c"]
        assert out.metadata["delegated_by"] == "agent-b"
        assert out.metadata["delegated_to"] == ["agent-c"]

    def test_needs_input_is_non_consuming(self, db, ws3):
        """An agent may ask a question mid-task and still owe the result:
        needs_input routes to the delegator but does not claim the single
        terminal receipt."""
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        out = _handle(db, ws, _reply(
            "openagents:agent-b", "which env?", in_reply_to=e1.id, reply_kind="needs_input",
        ))
        assert out.metadata["target_agents"] == ["agent-a"]
        db.refresh(e1)
        assert "receipt_from" not in (e1.metadata_ or {})
        # The real terminal result afterwards still lands deterministically.
        out2 = _handle(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out2.metadata["target_agents"] == ["agent-a"]
        db.refresh(e1)
        assert e1.metadata_["receipt_from"] == ["agent-b"]

    def test_delegator_removed_from_workspace_but_still_in_channel(self, db, ws3):
        """ChannelMember rows outlive WorkspaceMember removal — a receipt must
        not target an agent that can no longer poll the workspace."""
        ws = ws3["workspace"]
        e1 = _delegation_event(db, ws)
        from sqlalchemy import select
        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ws.id,
                WorkspaceMember.agent_name == "agent-a",
            )
        ).scalar_one()
        db.delete(member)
        db.flush()
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_delegator_soft_removed_from_workspace(self, db, ws3):
        ws = ws3["workspace"]
        e1 = _delegation_event(db, ws)
        from sqlalchemy import select
        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ws.id,
                WorkspaceMember.agent_name == "agent-a",
            )
        ).scalar_one()
        member.status = "removed"
        db.flush()
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]

    def test_ack_of_receipt_does_not_bounce(self, db, ws3):
        """A's reply to B's receipt references E2, which carries no
        delegated_by — so it must not deterministically bounce back to B."""
        ws, e1 = ws3["workspace"], _delegation_event(db, ws3["workspace"])
        e2_event = _reply(
            "openagents:agent-b", "done", in_reply_to=e1.id, reply_kind="result",
        )
        _handle(db, ws, e2_event)
        # Persist E2 the way PersistenceMod would.
        db.add(EventRecord(
            id=e2_event.id, network_id=ws.id, type=e2_event.type,
            source=e2_event.source, target=e2_event.target,
            payload=e2_event.payload, metadata_=e2_event.metadata,
            timestamp=e2_event.timestamp,
        ))
        db.flush()
        out, _ = self._stop_routed(db, ws, _reply(
            "openagents:agent-a", "thanks!", in_reply_to=e2_event.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["__no_response__"]


class TestMasterMode:
    @pytest.fixture
    def master_ws(self, db, ws3):
        ch = ws3["channel"]
        ch.master_agent = "agent-a"
        ch.orchestration_mode = "master"
        db.flush()
        db.refresh(ch)
        return ws3

    def test_receipt_in_master_mode_ignores_onward_mentions(self, db, master_ws):
        """Star topology stays authoritative: a sub-agent's receipt cannot
        delegate onward, even if it @mentions another sub."""
        ws = master_ws["workspace"]
        e1 = _delegation_event(db, ws)  # master agent-a delegated to agent-b
        out = _handle(db, ws, _reply(
            "openagents:agent-b", "done, @agent-c could verify.",
            in_reply_to=e1.id, reply_kind="result",
        ))
        assert out.metadata["target_agents"] == ["agent-a"]
        assert "delegated_by" not in out.metadata


class TestDelegationMarking:
    def test_master_mention_marks_delegation(self, db, ws3):
        """Explicit @mention delegation gets server-written delegated_by/to
        (router mocked to route to the mentioned agent)."""
        ws = ws3["workspace"]
        client_patch, _ = _with_router("next:agent-b")
        with ROUTER_PATCHES[0], ROUTER_PATCHES[1], client_patch:
            out = _handle(db, ws, _reply(
                "openagents:agent-a", "@agent-b please handle this.",
            ))
        assert out.metadata["target_agents"] == ["agent-b"]
        assert out.metadata["delegated_by"] == "agent-a"
        assert out.metadata["delegated_to"] == ["agent-b"]

    def test_router_inferred_hop_not_marked(self, db, ws3):
        """Router routing without a mention (e.g. report to master) is NOT a
        delegation — marking it would bounce acknowledgements."""
        ws = ws3["workspace"]
        client_patch, _ = _with_router("next:agent-a")
        with ROUTER_PATCHES[0], ROUTER_PATCHES[1], client_patch:
            out = _handle(db, ws, _reply(
                "openagents:agent-b", "Reporting back with findings.",
            ))
        assert out.metadata["target_agents"] == ["agent-a"]
        assert "delegated_by" not in out.metadata

    def test_human_message_never_marked(self, db, ws3):
        ws = ws3["workspace"]
        client_patch, _ = _with_router("next:agent-b")
        with ROUTER_PATCHES[0], ROUTER_PATCHES[1], client_patch:
            out = _handle(db, ws, _reply("human:user", "@agent-b please help"))
        assert out.metadata["target_agents"] == ["agent-b"]
        assert "delegated_by" not in out.metadata
