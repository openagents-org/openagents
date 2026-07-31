"""Tests for the server-side wait-for graph deadlock detection."""

import asyncio
from unittest.mock import MagicMock

import pytest

from openagents.models.event import Event, EventSubscription
from openagents.sdk.wait_graph import DEADLOCK_EVENT_NAME, WaitGraphMonitor


def blocking_request(
    source: str,
    target: str,
    name: str = "thread.direct_message.send",
    wait_timeout: float = 30.0,
) -> Event:
    """A request sent by a blocking wait primitive (send_and_wait)."""
    return Event(
        event_name=name,
        source_id=source,
        destination_id=target,
        requires_response=True,
        metadata={"blocking_wait": True, "wait_timeout": wait_timeout},
        payload={},
    )


def continuation_request(source: str, target: str) -> Event:
    """A fire-and-forget request that expects a reply but does not block."""
    return Event(
        event_name="thread.direct_message.send",
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
        await monitor.observe(blocking_request("alice", "bob"))
        assert delivered == []
        assert monitor.waiting_targets("alice") == ["bob"]

    async def test_fire_and_forget_requests_create_no_edges(
        self, monitor, delivered
    ):
        """requires_response alone does not prove the sender is blocked; a
        continuation request must never join a deadlock report."""
        await monitor.observe(continuation_request("alice", "bob"))
        assert monitor.waiting_targets("alice") == []

        # Even opposing continuation requests report nothing.
        await monitor.observe(continuation_request("bob", "alice"))
        assert delivered == []

    async def test_continuation_does_not_falsify_real_wait(
        self, monitor, delivered
    ):
        """A blocking wait one way plus a continuation the other way is not
        a deadlock — the continuation sender is free to answer."""
        await monitor.observe(blocking_request("alice", "bob"))
        await monitor.observe(continuation_request("bob", "alice"))
        assert delivered == []

    async def test_response_clears_the_edge(self, monitor, delivered):
        request = blocking_request("alice", "bob")
        await monitor.observe(request)
        await monitor.observe(response_event("bob", "alice", request.event_id))
        assert monitor.waiting_targets("alice") == []

        # bob can now wait on alice without a (stale) cycle being reported
        await monitor.observe(blocking_request("bob", "alice"))
        assert delivered == []

    async def test_mutual_wait_detected_and_both_notified(self, monitor, delivered):
        request_ab = blocking_request("alice", "bob")
        request_ba = blocking_request("bob", "alice")
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

    async def test_agent_prefix_aliases_join_one_graph(self, monitor, delivered):
        """alice -> agent:bob and bob -> agent:alice must close a cycle."""
        await monitor.observe(blocking_request("alice", "agent:bob"))
        await monitor.observe(blocking_request("bob", "agent:alice"))

        notified = {event.destination_id for event in delivered}
        assert notified == {"alice", "bob"}

    async def test_self_wait_reported_as_cycle(self, monitor, delivered):
        """An agent blocking on itself can never be answered."""
        await monitor.observe(blocking_request("alice", "agent:alice"))

        assert len(delivered) == 1
        assert delivered[0].destination_id == "alice"
        assert delivered[0].payload["cycle"] == ["alice", "alice"]

    async def test_three_agent_cycle_detected(self, monitor, delivered):
        await monitor.observe(blocking_request("alice", "bob"))
        await monitor.observe(blocking_request("bob", "charlie"))
        assert delivered == []

        await monitor.observe(blocking_request("charlie", "alice"))

        notified = {event.destination_id for event in delivered}
        assert notified == {"alice", "bob", "charlie"}

    async def test_only_cycle_edges_are_reported(self, monitor, delivered):
        """An unrelated concurrent request between the same agents must not
        be named in the report (its waiter would abort for no reason)."""
        in_cycle = blocking_request("alice", "bob")
        unrelated = blocking_request("alice", "bob")
        closes_cycle = blocking_request("bob", "alice")

        await monitor.observe(in_cycle)
        await monitor.observe(unrelated)
        await monitor.observe(closes_cycle)

        assert delivered
        request_ids = set(delivered[0].payload["request_ids"])
        assert closes_cycle.event_id in request_ids
        assert len(request_ids) == 2
        assert unrelated.event_id not in request_ids

    async def test_cycle_edges_removed_after_notification(self, monitor, delivered):
        """The notified waiters return immediately, so a later one-way wait
        between the same agents must not be reported again."""
        await monitor.observe(blocking_request("alice", "bob"))
        await monitor.observe(blocking_request("bob", "alice"))
        assert len(delivered) == 2
        delivered.clear()

        # Both waits are gone; a fresh one-way wait is not a deadlock.
        await monitor.observe(blocking_request("bob", "alice"))
        assert delivered == []
        assert monitor.waiting_targets("alice") == []
        assert monitor.waiting_targets("bob") == ["alice"]

    async def test_stringified_metadata_from_grpc_is_parsed(
        self, monitor, delivered
    ):
        """gRPC transports metadata as map<string,string>; 'False' must not
        count as a blocking wait and numeric strings must keep their value."""
        stringly_false = blocking_request("alice", "bob")
        stringly_false.metadata = {"blocking_wait": "False"}
        await monitor.observe(stringly_false)
        assert monitor.waiting_targets("alice") == []

        stringly_true = blocking_request("alice", "bob")
        stringly_true.metadata = {"blocking_wait": "True", "wait_timeout": "0.01"}
        await monitor.observe(stringly_true)
        assert monitor.waiting_targets("alice") == ["bob"]

        await asyncio.sleep(0.05)
        await monitor.observe(blocking_request("bob", "alice"))
        assert delivered == []  # the 0.01s edge expired; no cycle

    async def test_no_false_positive_on_shared_target(self, monitor, delivered):
        await monitor.observe(blocking_request("alice", "bob"))
        await monitor.observe(blocking_request("charlie", "bob"))
        assert delivered == []

    async def test_notification_relays_do_not_create_edges(self, monitor, delivered):
        relay = blocking_request(
            "alice", "bob", name="thread.direct_message.notification"
        )
        await monitor.observe(relay)
        assert monitor.waiting_targets("alice") == []

    async def test_channel_and_broadcast_traffic_ignored(self, monitor, delivered):
        await monitor.observe(blocking_request("alice", "channel:general"))
        await monitor.observe(blocking_request("alice", "agent:broadcast"))
        assert monitor.waiting_targets("alice") == []

    async def test_edges_expire_at_the_waiter_deadline(self, monitor, delivered):
        """The edge lives only as long as the wait it represents — after the
        waiter's own timeout it must not report cycles anymore."""
        await monitor.observe(blocking_request("alice", "bob", wait_timeout=0.01))
        await asyncio.sleep(0.05)
        await monitor.observe(blocking_request("bob", "alice"))
        assert delivered == []

    async def test_expired_edges_are_purged(self, delivered):
        async def deliver(event):
            delivered.append(event)

        monitor = WaitGraphMonitor(
            network_id="test-network", deliver=deliver, edge_ttl_seconds=0.0
        )
        # No per-request deadline: falls back to the (zero) default TTL.
        request = blocking_request("alice", "bob")
        request.metadata = {"blocking_wait": True}
        await monitor.observe(request)
        # The edge expired immediately; the reverse wait closes no cycle.
        reverse = blocking_request("bob", "alice")
        reverse.metadata = {"blocking_wait": True}
        await monitor.observe(reverse)
        assert delivered == []


class TestDeadlockNotificationDelivery:
    """Deadlock reports must reach the agent whatever it subscribed to."""

    def make_gateway(self):
        from openagents.sdk.event_gateway import EventGateway

        network = MagicMock()
        network.network_id = "test-network"
        network.mods = {}
        return EventGateway(network)

    async def test_deadlock_event_bypasses_subscription_filter(self):
        gateway = self.make_gateway()
        gateway.register_agent("alice")
        # alice only subscribed to thread.* events
        gateway.agent_subscriptions["alice"] = [
            EventSubscription(agent_id="alice", event_patterns=["thread.*"])
        ]

        deadlock = Event(
            event_name=DEADLOCK_EVENT_NAME,
            source_id="test-network",
            destination_id="alice",
            payload={"cycle": ["alice", "bob", "alice"], "request_ids": []},
        )
        await gateway.deliver_to_agent(deadlock, "alice")

        events = [
            gateway.agent_event_queues["alice"].get_nowait()
            for _ in range(gateway.agent_event_queues["alice"].qsize())
        ]
        assert [e.event_name for e in events] == [DEADLOCK_EVENT_NAME]

    async def test_ordinary_events_still_filtered(self):
        gateway = self.make_gateway()
        gateway.register_agent("alice")
        gateway.agent_subscriptions["alice"] = [
            EventSubscription(agent_id="alice", event_patterns=["thread.*"])
        ]

        unrelated = Event(
            event_name="feed.post.created",
            source_id="bob",
            destination_id="alice",
            payload={},
        )
        await gateway.deliver_to_agent(unrelated, "alice")

        assert gateway.agent_event_queues["alice"].qsize() == 0
