"""Tests for the server-side wait-for graph deadlock detection."""

import pytest

from openagents.models.event import Event
from openagents.sdk.wait_graph import DEADLOCK_EVENT_NAME, WaitGraphMonitor


def request_event(source: str, target: str, name: str = "thread.direct_message.send") -> Event:
    return Event(
        event_name=name,
        source_id=source,
        destination_id=target,
        requires_response=True,
        payload={},
    )


def response_event(source: str, target: str, response_to: str) -> Event:
    return Event(
        event_name="thread.direct_message.send",
        source_id=source,
        destination_id=target,
        response_to=response_to,
        payload={},
    )


@pytest.fixture
def delivered():
    return []


@pytest.fixture
def monitor(delivered):
    async def deliver(event):
        delivered.append(event)

    return WaitGraphMonitor(network_id="test-network", deliver=deliver)


class TestWaitGraphMonitor:
    async def test_single_wait_no_deadlock(self, monitor, delivered):
        await monitor.observe(request_event("alice", "bob"))
        assert delivered == []
        assert monitor.waiting_targets("alice") == ["bob"]

    async def test_response_clears_the_edge(self, monitor, delivered):
        request = request_event("alice", "bob")
        await monitor.observe(request)
        await monitor.observe(response_event("bob", "alice", request.event_id))
        assert monitor.waiting_targets("alice") == []

        # bob can now wait on alice without a (stale) cycle being reported
        await monitor.observe(request_event("bob", "alice"))
        assert delivered == []

    async def test_mutual_wait_detected_and_both_notified(self, monitor, delivered):
        request_ab = request_event("alice", "bob")
        request_ba = request_event("bob", "alice")
        await monitor.observe(request_ab)
        await monitor.observe(request_ba)

        assert len(delivered) == 2
        notified = {event.destination_id for event in delivered}
        assert notified == {"alice", "bob"}
        for event in delivered:
            assert event.event_name == DEADLOCK_EVENT_NAME
            assert set(event.payload["request_ids"]) == {
                request_ab.event_id,
                request_ba.event_id,
            }
            assert event.payload["cycle"][0] == event.payload["cycle"][-1]

    async def test_three_agent_cycle_detected(self, monitor, delivered):
        await monitor.observe(request_event("alice", "bob"))
        await monitor.observe(request_event("bob", "charlie"))
        assert delivered == []

        await monitor.observe(request_event("charlie", "alice"))

        notified = {event.destination_id for event in delivered}
        assert notified == {"alice", "bob", "charlie"}

    async def test_no_false_positive_on_shared_target(self, monitor, delivered):
        await monitor.observe(request_event("alice", "bob"))
        await monitor.observe(request_event("charlie", "bob"))
        assert delivered == []

    async def test_notification_relays_do_not_create_edges(self, monitor, delivered):
        relay = request_event(
            "alice", "bob", name="thread.direct_message.notification"
        )
        await monitor.observe(relay)
        assert monitor.waiting_targets("alice") == []

    async def test_channel_and_broadcast_traffic_ignored(self, monitor, delivered):
        await monitor.observe(request_event("alice", "channel:general"))
        await monitor.observe(request_event("alice", "agent:broadcast"))
        assert monitor.waiting_targets("alice") == []

    async def test_expired_edges_are_purged(self, delivered):
        async def deliver(event):
            delivered.append(event)

        monitor = WaitGraphMonitor(
            network_id="test-network", deliver=deliver, edge_ttl_seconds=0.0
        )
        await monitor.observe(request_event("alice", "bob"))
        # The edge expired immediately; the reverse wait closes no cycle.
        await monitor.observe(request_event("bob", "alice"))
        assert delivered == []
