# -*- coding: utf-8 -*-
"""Tests for ONM events module."""

import time

from openagents.sdk.onm_events import (
    CoreEventTypes,
    Event,
    EventVisibility,
    WorkspaceEventTypes,
)


class TestEventCreation:
    """Creating events with default and explicit values."""

    def test_minimal_event(self):
        e = Event(type="workspace.message.posted", source="agent:alice", target="channel/general")
        assert e.type == "workspace.message.posted"
        assert e.source == "agent:alice"
        assert e.target == "channel/general"
        assert e.id  # auto-generated UUID
        assert e.timestamp > 0
        assert e.payload is None
        assert e.metadata == {}
        assert e.network == ""
        assert e.visibility == "channel"

    def test_full_event(self):
        e = Event(
            id="evt-123",
            type="network.agent.join",
            source="openagents:claude",
            target="core",
            payload={"agent_name": "claude"},
            metadata={"in_reply_to": "evt-100"},
            timestamp=1000000,
            network="ws-abc",
            visibility=EventVisibility.PUBLIC,
        )
        assert e.id == "evt-123"
        assert e.network == "ws-abc"
        assert e.visibility == "public"
        assert e.payload == {"agent_name": "claude"}
        assert e.in_reply_to == "evt-100"

    def test_timestamp_is_milliseconds(self):
        before = int(time.time() * 1000)
        e = Event(type="network.ping", source="agent:a", target="core")
        after = int(time.time() * 1000)
        assert before <= e.timestamp <= after + 1

    def test_unique_ids(self):
        e1 = Event(type="network.ping", source="agent:a", target="core")
        e2 = Event(type="network.ping", source="agent:a", target="core")
        assert e1.id != e2.id

    def test_in_reply_to_none_when_missing(self):
        e = Event(type="network.ping", source="agent:a", target="core")
        assert e.in_reply_to is None


class TestEventReply:
    """The as_reply() convenience method."""

    def test_reply_swaps_source_target(self):
        original = Event(
            id="evt-orig",
            type="network.ping",
            source="agent:alice",
            target="core",
            network="ws-1",
        )
        reply = original.as_reply(type="network.pong", payload={"status": "ok"})
        assert reply.source == "core"
        assert reply.target == "agent:alice"
        assert reply.type == "network.pong"
        assert reply.metadata["in_reply_to"] == "evt-orig"
        assert reply.network == "ws-1"
        assert reply.payload == {"status": "ok"}

    def test_reply_gets_new_id(self):
        original = Event(id="evt-orig", type="network.ping", source="agent:alice", target="core")
        reply = original.as_reply(type="network.pong")
        assert reply.id != "evt-orig"


class TestEventSerialization:
    """Pydantic model_dump / model_validate round-trip."""

    def test_round_trip(self):
        e = Event(
            type="workspace.message.posted",
            source="openagents:claude",
            target="channel/session-1",
            payload={"content": "Hello", "mentions": ["agent:bob"]},
            metadata={"in_reply_to": "evt-100"},
        )
        data = e.model_dump()
        e2 = Event.model_validate(data)
        assert e2.type == e.type
        assert e2.source == e.source
        assert e2.target == e.target
        assert e2.payload == e.payload
        assert e2.metadata == e.metadata
        assert e2.id == e.id
        assert e2.timestamp == e.timestamp

    def test_json_round_trip(self):
        e = Event(type="network.ping", source="agent:a", target="core")
        json_str = e.model_dump_json()
        e2 = Event.model_validate_json(json_str)
        assert e2.id == e.id


class TestEventTypes:
    """Event type constants."""

    def test_core_types_start_with_network(self):
        for attr in dir(CoreEventTypes):
            if attr.startswith("_"):
                continue
            value = getattr(CoreEventTypes, attr)
            assert value.startswith("network."), f"{attr} = {value} doesn't start with 'network.'"

    def test_workspace_types_start_with_workspace(self):
        for attr in dir(WorkspaceEventTypes):
            if attr.startswith("_"):
                continue
            value = getattr(WorkspaceEventTypes, attr)
            assert value.startswith("workspace."), f"{attr} = {value} doesn't start with 'workspace.'"
