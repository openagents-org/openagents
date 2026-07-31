"""Tests for synchronous-wait governance in agent-to-agent messaging.

Covers the failure modes behind "two agents waiting on each other":

1. Lost wakeup: a reply arriving before the waiter was registered was lost
   (send_and_wait used to send first and register the waiter afterwards).
2. Misclassification: a counter-request from the peer used to be mistaken for
   the reply because waiters matched on source_id only.
3. Concurrent waiters: two in-flight requests to the same peer used to race
   for whichever message came back first.
4. Blocking waits inside react(): the runner processes one event at a time, so
   blocking in react() stalls the agent; primitives now warn (or raise in
   strict mode) when called from a react() scope.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.sdk.client import AgentClient
from openagents.sdk.react_context import (
    BlockingWaitInReactError,
    STRICT_ENV_VAR,
    current_react_agent,
    react_scope,
)
from openagents.sdk.workspace import Workspace


AGENT_A = "agent-alice"
AGENT_B = "agent-bob"


def make_workspace(agent_id: str = AGENT_A) -> Workspace:
    """Build a workspace whose client is 'connected' but sends nothing."""
    client = AgentClient(agent_id=agent_id)
    client.connector = MagicMock()  # non-None so wait primitives don't bail out
    workspace = Workspace(client)
    workspace._ensure_connected = AsyncMock(return_value=True)
    return workspace


def dm_notification(
    sender: str,
    text: str,
    response_to: str = None,
    requires_response: bool = False,
) -> Event:
    """Build a thread.direct_message.notification as the messaging mod delivers it."""
    return Event(
        event_name="thread.direct_message.notification",
        source_id=sender,
        destination_id=AGENT_A,
        payload={
            "sender_id": sender,
            "content": {"text": text},
        },
        response_to=response_to,
        requires_response=requires_response,
    )


class TestSendAndWaitCorrelation:
    """AgentConnection.send_and_wait request/reply correlation."""

    async def test_reply_arriving_during_send_is_not_lost(self):
        """The waiter must be registered before the request is sent."""
        workspace = make_workspace()
        client = workspace.client

        async def send_event_with_instant_reply(event):
            # Reply lands while send_event is still in flight — before the
            # old implementation would have registered its waiter.
            await client._handle_event(
                dm_notification(AGENT_B, "instant reply", response_to=event.event_id)
            )
            return EventResponse(success=True, message="ok")

        workspace.send_event = AsyncMock(side_effect=send_event_with_instant_reply)

        reply = await workspace.agent(AGENT_B).send_and_wait("ping", timeout=1.0)

        assert reply is not None
        assert reply["content"]["text"] == "instant reply"

    async def test_counter_request_is_not_mistaken_for_reply(self):
        """A request from the peer (requires_response) must not satisfy the wait."""
        workspace = make_workspace()
        client = workspace.client
        workspace.send_event = AsyncMock(
            return_value=EventResponse(success=True, message="ok")
        )

        async def peer_sends_counter_request():
            await asyncio.sleep(0.05)
            await client._handle_event(
                dm_notification(AGENT_B, "counter request", requires_response=True)
            )

        peer_task = asyncio.create_task(peer_sends_counter_request())
        reply = await workspace.agent(AGENT_B).send_and_wait("ping", timeout=0.3)
        await peer_task

        assert reply is None

    async def test_correlated_reply_wins_over_unrelated_traffic(self):
        """Only the reply carrying our request id is accepted."""
        workspace = make_workspace()
        client = workspace.client

        sent_events = []

        async def capture_send(event):
            sent_events.append(event)
            return EventResponse(success=True, message="ok")

        workspace.send_event = AsyncMock(side_effect=capture_send)

        async def peer_traffic():
            await asyncio.sleep(0.05)
            # A counter-request first, then the real correlated reply.
            await client._handle_event(
                dm_notification(AGENT_B, "counter request", requires_response=True)
            )
            await client._handle_event(
                dm_notification(
                    AGENT_B, "real reply", response_to=sent_events[0].event_id
                )
            )

        peer_task = asyncio.create_task(peer_traffic())
        reply = await workspace.agent(AGENT_B).send_and_wait("ping", timeout=1.0)
        await peer_task

        assert reply is not None
        assert reply["content"]["text"] == "real reply"

    async def test_concurrent_waiters_each_get_their_own_reply(self):
        """Two in-flight requests to the same agent must not swap replies."""
        workspace = make_workspace()
        client = workspace.client

        sent_events = []

        async def capture_send(event):
            sent_events.append(event)
            return EventResponse(success=True, message="ok")

        workspace.send_event = AsyncMock(side_effect=capture_send)

        async def peer_replies_in_reverse_order():
            while len(sent_events) < 2:
                await asyncio.sleep(0.01)
            for event in reversed(sent_events):
                text = f"reply to {event.payload['content']['text']}"
                await client._handle_event(
                    dm_notification(AGENT_B, text, response_to=event.event_id)
                )

        peer_task = asyncio.create_task(peer_replies_in_reverse_order())
        connection = workspace.agent(AGENT_B)
        reply_one, reply_two = await asyncio.gather(
            connection.send_and_wait("first", timeout=1.0),
            connection.send_and_wait("second", timeout=1.0),
        )
        await peer_task

        assert reply_one["content"]["text"] == "reply to first"
        assert reply_two["content"]["text"] == "reply to second"

    async def test_legacy_reply_without_response_to_still_accepted(self):
        """Peers that don't correlate replies keep working (fallback match)."""
        workspace = make_workspace()
        client = workspace.client
        workspace.send_event = AsyncMock(
            return_value=EventResponse(success=True, message="ok")
        )

        async def peer_plain_reply():
            await asyncio.sleep(0.05)
            await client._handle_event(dm_notification(AGENT_B, "plain reply"))

        peer_task = asyncio.create_task(peer_plain_reply())
        reply = await workspace.agent(AGENT_B).send_and_wait("ping", timeout=1.0)
        await peer_task

        assert reply is not None
        assert reply["content"]["text"] == "plain reply"

    async def test_send_failure_returns_none_and_deregisters_waiter(self):
        workspace = make_workspace()
        workspace.send_event = AsyncMock(
            return_value=EventResponse(success=False, message="boom")
        )

        reply = await workspace.agent(AGENT_B).send_and_wait("ping", timeout=0.2)

        assert reply is None
        assert workspace.client._event_waiters == []


class TestEventWaiterSemantics:
    async def test_all_matching_waiters_are_woken_by_one_event(self):
        """Documented semantics: one event satisfies every matching waiter."""
        client = AgentClient(agent_id=AGENT_A)
        client.connector = MagicMock()

        waiter_one = client.expect_event(lambda e: e.source_id == AGENT_B)
        waiter_two = client.expect_event(lambda e: e.source_id == AGENT_B)

        await client._handle_event(dm_notification(AGENT_B, "broadcast-ish"))

        event_one = await waiter_one.wait(timeout=0.2)
        event_two = await waiter_two.wait(timeout=0.2)
        assert event_one is not None
        assert event_two is not None

    async def test_waiter_cancel_removes_registration(self):
        client = AgentClient(agent_id=AGENT_A)
        client.connector = MagicMock()

        waiter = client.expect_event(lambda e: True)
        assert len(client._event_waiters) == 1
        waiter.cancel()
        assert client._event_waiters == []
        waiter.cancel()  # idempotent


class TestChannelReplyCorrelation:
    def reply_notification(self, channel: str, reply_to_id: str, text: str) -> Event:
        """Build a thread.reply.notification as the messaging mod delivers it."""
        return Event(
            event_name="thread.reply.notification",
            source_id=AGENT_B,
            destination_id=AGENT_A,
            payload={
                "channel": channel,
                "reply_to_id": reply_to_id,
                "content": {"text": text},
            },
        )

    async def test_post_and_wait_matches_reply_to_posted_message(self):
        workspace = make_workspace()
        client = workspace.client

        sent_events = []

        async def capture_send(event):
            sent_events.append(event)
            return EventResponse(success=True, message="ok")

        workspace.send_event = AsyncMock(side_effect=capture_send)

        async def peer_replies():
            while not sent_events:
                await asyncio.sleep(0.01)
            post_id = sent_events[0].event_id
            # A reply to some other message must be ignored...
            await client._handle_event(
                self.reply_notification("general", "unrelated-id", "wrong thread")
            )
            # ...and the reply to our post accepted.
            await client._handle_event(
                self.reply_notification("general", post_id, "the answer")
            )

        peer_task = asyncio.create_task(peer_replies())
        reply = await workspace.channel("general").post_and_wait(
            "question", timeout=1.0
        )
        await peer_task

        assert reply is not None
        assert reply["content"]["text"] == "the answer"


class TestReactScopeGuard:
    async def test_blocking_wait_inside_react_warns(self):
        workspace = make_workspace()
        workspace.send_event = AsyncMock(
            return_value=EventResponse(success=True, message="ok")
        )

        with react_scope(AGENT_A):
            with pytest.warns(DeprecationWarning, match="send_and_wait"):
                await workspace.agent(AGENT_B).send_and_wait("ping", timeout=0.05)

    async def test_blocking_wait_inside_react_strict_raises(self, monkeypatch):
        monkeypatch.setenv(STRICT_ENV_VAR, "1")
        workspace = make_workspace()
        workspace.send_event = AsyncMock(
            return_value=EventResponse(success=True, message="ok")
        )

        with react_scope(AGENT_A):
            with pytest.raises(BlockingWaitInReactError):
                await workspace.agent(AGENT_B).send_and_wait("ping", timeout=0.05)

        # Nothing was sent and no waiter leaked.
        workspace.send_event.assert_not_awaited()
        assert workspace.client._event_waiters == []

    async def test_no_warning_outside_react(self, recwarn):
        workspace = make_workspace()
        workspace.send_event = AsyncMock(
            return_value=EventResponse(success=True, message="ok")
        )

        await workspace.agent(AGENT_B).send_and_wait("ping", timeout=0.05)

        deprecations = [
            w for w in recwarn.list if issubclass(w.category, DeprecationWarning)
        ]
        assert deprecations == []

    def test_react_scope_sets_and_resets_context(self):
        assert current_react_agent.get() is None
        with react_scope(AGENT_A):
            assert current_react_agent.get() == AGENT_A
        assert current_react_agent.get() is None


class TestMessagingModCorrelationRelay:
    """The mod must preserve correlation fields when relaying direct messages."""

    async def test_direct_message_notification_carries_correlation_fields(self):
        from openagents.mods.workspace.messaging.mod import ThreadMessagingNetworkMod

        mod = ThreadMessagingNetworkMod()
        mod._network = MagicMock()
        mod._network.process_event = AsyncMock()

        request = Event(
            event_name="thread.direct_message.send",
            source_id=AGENT_A,
            destination_id=AGENT_B,
            payload={
                "target_agent_id": AGENT_B,
                "message_type": "direct_message",
                "content": {"text": "ping"},
            },
            requires_response=True,
        )

        await mod._process_direct_message(request)

        mod._network.process_event.assert_awaited_once()
        notification = mod._network.process_event.await_args.args[0]
        assert notification.event_name == "thread.direct_message.notification"
        assert notification.destination_id == AGENT_B
        assert notification.requires_response is True
        assert notification.payload["message_id"] == request.event_id

        # And the reply relays its response_to back to the requester.
        mod._network.process_event.reset_mock()
        reply = Event(
            event_name="thread.direct_message.send",
            source_id=AGENT_B,
            destination_id=AGENT_A,
            payload={
                "target_agent_id": AGENT_A,
                "message_type": "direct_message",
                "content": {"text": "pong"},
            },
            response_to=request.event_id,
        )

        await mod._process_direct_message(reply)

        notification = mod._network.process_event.await_args.args[0]
        assert notification.response_to == request.event_id
        assert notification.requires_response is False
