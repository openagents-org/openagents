"""Regression test: gRPC SendEvent must carry a deadline.

Without a timeout on the SendEvent RPC, a stalled server blocks the calling
agent forever — send_and_wait timeouts never fire because the send itself
never returns.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from openagents.models.event import Event
from openagents.sdk.connectors.grpc_connector import GRPCNetworkConnector


@pytest.mark.asyncio
async def test_send_event_uses_deadline():
    connector = GRPCNetworkConnector(host="localhost", port=50051, agent_id="alice")
    connector.is_connected = True
    connector.stub = MagicMock()
    # Proto stubs are only loaded on connect(); the wire encoding is not what
    # this test is about.
    connector._to_grpc_event = MagicMock(return_value=MagicMock())

    grpc_response = MagicMock()
    grpc_response.success = True
    grpc_response.message = "ok"
    grpc_response.data = None
    connector.stub.SendEvent = AsyncMock(return_value=grpc_response)

    event = Event(
        event_name="thread.direct_message.send",
        source_id="alice",
        destination_id="bob",
        payload={"content": {"text": "ping"}},
    )

    await connector.send_event(event)

    connector.stub.SendEvent.assert_awaited_once()
    call = connector.stub.SendEvent.await_args
    assert call.kwargs.get("timeout") == 30.0
