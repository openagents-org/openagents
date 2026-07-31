"""Regression test: request correlation must survive the gRPC transport.

response_to drives precise reply matching and wait-graph edge clearing;
requires_response tells counter-requests apart from replies. Both used to be
dropped on gRPC ingress because the proto had no fields for them.
"""

import pytest

from openagents.models.event import Event
from openagents.proto import agent_service_pb2
from openagents.sdk.connectors.grpc_connector import GRPCNetworkConnector
from openagents.sdk.transports.grpc import internal_event_from_grpc


def make_connector() -> GRPCNetworkConnector:
    connector = GRPCNetworkConnector(host="localhost", port=50051, agent_id="alice")
    # Normally loaded on connect()
    connector.agent_service_pb2 = agent_service_pb2
    return connector


@pytest.mark.asyncio
async def test_event_correlation_survives_grpc_roundtrip():
    connector = make_connector()

    original = Event(
        event_name="thread.direct_message.send",
        source_id="alice",
        destination_id="bob",
        payload={"content": {"text": "pong"}},
        requires_response=True,
        response_to="request-123",
        metadata={"blocking_wait": True, "wait_timeout": 5.0},
    )

    grpc_event = connector._to_grpc_event(original)
    assert grpc_event.requires_response is True
    assert grpc_event.response_to == "request-123"

    # Server-side conversion (payload extraction is tested elsewhere)
    restored = internal_event_from_grpc(grpc_event, dict(original.payload))

    assert restored.event_id == original.event_id
    assert restored.requires_response is True
    assert restored.response_to == "request-123"
    assert restored.destination_id == "bob"
    # gRPC metadata is stringified; the wait-graph parses these leniently
    assert restored.metadata["blocking_wait"] == "True"
    assert restored.metadata["wait_timeout"] == "5.0"


@pytest.mark.asyncio
async def test_plain_event_roundtrip_defaults():
    connector = make_connector()

    original = Event(
        event_name="thread.direct_message.send",
        source_id="alice",
        destination_id="bob",
        payload={},
    )

    restored = internal_event_from_grpc(
        connector._to_grpc_event(original), {}
    )

    assert restored.requires_response is False
    assert restored.response_to is None
