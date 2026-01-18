"""
Integration tests for the Hello World demo.

This test suite verifies that the Charlie agent in the Hello World demo
correctly responds to both channel messages and direct messages end-to-end.

The tests require an LLM API key to be set via environment variables:
- OPENAI_API_KEY: For direct OpenAI API access
- Or DEFAULT_LLM_API_KEY + DEFAULT_LLM_MODEL_NAME + DEFAULT_LLM_PROVIDER: For auto model config

Usage:
    # Set your API key
    export OPENAI_API_KEY=your_api_key_here

    # Or use auto model configuration
    export DEFAULT_LLM_API_KEY=your_api_key_here
    export DEFAULT_LLM_MODEL_NAME=gpt-4o-mini
    export DEFAULT_LLM_PROVIDER=openai

    # Run the tests
    pytest tests/integration/test_hello_world_demo.py -v -s
"""

import pytest
import asyncio
import os
from pathlib import Path
from typing import List

from openagents.core.client import AgentClient
from openagents.agents.runner import AgentRunner
from openagents.models.event import Event

from tests.integration.conftest import check_llm_api_key, skip_without_api_key


@pytest.fixture
async def charlie_agent(hello_world_network, hello_world_agent_config_path):
    """Create and start the Charlie agent from the Hello World demo config.

    This loads Charlie from the demo YAML configuration and starts it
    connected to the test network.
    """
    network, config, grpc_port, http_port = hello_world_network

    # Load Charlie agent from YAML with connection override for test ports
    connection_override = {
        "host": "localhost",
        "port": http_port,
        "transport": "http"  # Use HTTP for simpler testing
    }

    agent = AgentRunner.from_yaml(
        str(hello_world_agent_config_path),
        connection_override=connection_override
    )

    # Start the agent
    await agent.async_start(network_host="localhost", network_port=http_port)

    # Give agent time to connect and register with mods
    await asyncio.sleep(2.0)
    print(f"Charlie agent started and connected to network on port {http_port}")

    yield agent

    # Cleanup
    try:
        await agent.async_stop()
        print("Charlie agent stopped")
    except Exception as e:
        print(f"Error stopping Charlie agent: {e}")


@pytest.mark.asyncio
@pytest.mark.integration
@skip_without_api_key()
async def test_charlie_responds_to_channel_message(charlie_agent, user_client, hello_world_network):
    """Test that Charlie responds to messages in the general channel.

    This test verifies the end-to-end flow:
    1. A user sends a message to the 'general' channel
    2. Charlie (with react_to_all_messages=true) receives the message
    3. Charlie calls the LLM to generate a response
    4. Charlie posts a reply back to the channel

    This mimics a user chatting in the Hello World demo UI.
    """
    network, config, grpc_port, http_port = hello_world_network

    print("Testing Charlie responds to channel message...")

    # Track messages received by the user client
    received_messages: List[Event] = []

    async def message_handler(event: Event):
        print(f"User received event: {event.event_name} from {event.source_id}")
        if event.payload:
            print(f"  Payload: {event.payload}")
        received_messages.append(event)

    # Register handler to capture Charlie's response
    user_client.register_event_handler(message_handler, ["agent.message", "thread.channel_message.notification"])

    # Send a greeting message to the general channel
    # Using thread.channel_message.post for channel messaging
    channel_message = Event(
        event_name="thread.channel_message.post",
        source_id="test_user",
        payload={
            "channel": "general",
            "content": {
                "text": "Hello Charlie! How are you today?",
            },
        },
    )

    print("Sending channel message: 'Hello Charlie! How are you today?'")
    response = await user_client.send_event(channel_message)

    if response:
        print(f"Channel message sent, response: success={response.success}")
    else:
        print("Channel message sent (no immediate response)")

    # Wait for Charlie to process and respond
    # LLM calls can take several seconds
    max_wait_seconds = 45
    poll_interval = 2
    elapsed = 0

    charlie_response_found = False

    while elapsed < max_wait_seconds:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        # Check if we received a response from Charlie
        charlie_responses = [
            msg for msg in received_messages
            if msg.source_id == "charlie" and msg.event_name in ["agent.message", "thread.channel_message.notification"]
        ]

        if charlie_responses:
            charlie_response_found = True
            print(f"Charlie responded after {elapsed}s")
            break

        print(f"Waiting for Charlie's response... ({elapsed}s elapsed)")

    # Verify Charlie responded
    assert charlie_response_found, (
        f"Charlie should have responded to the channel message within {max_wait_seconds}s. "
        f"Received {len(received_messages)} messages total: {[m.source_id for m in received_messages]}"
    )

    # Get Charlie's response
    charlie_responses = [
        msg for msg in received_messages
        if msg.source_id == "charlie"
    ]

    assert len(charlie_responses) >= 1, "Should have received at least one response from Charlie"

    response_msg = charlie_responses[0]
    print(f"Charlie's response event: {response_msg.event_name}")
    print(f"Charlie's response payload: {response_msg.payload}")

    # Verify the response has text content
    response_text = None
    if response_msg.payload:
        response_text = response_msg.payload.get("text") or response_msg.payload.get("content", {}).get("text")

    assert response_text and len(response_text) > 0, (
        f"Charlie's response should have non-empty text content. Payload: {response_msg.payload}"
    )

    print(f"Charlie's response: '{response_text}'")
    print("test_charlie_responds_to_channel_message PASSED")


@pytest.mark.asyncio
@pytest.mark.integration
@skip_without_api_key()
async def test_charlie_responds_to_direct_message(charlie_agent, user_client, hello_world_network):
    """Test that Charlie responds to direct messages.

    This test verifies the end-to-end flow for direct messaging:
    1. A user sends a direct message to Charlie
    2. Charlie receives the DM
    3. Charlie calls the LLM to generate a response
    4. Charlie sends a reply back to the user

    This mimics a user DMing the Charlie agent in the Hello World demo.
    """
    network, config, grpc_port, http_port = hello_world_network

    print("Testing Charlie responds to direct message...")

    # Track messages received by the user client
    received_messages: List[Event] = []
    message_received_event = asyncio.Event()

    async def message_handler(event: Event):
        print(f"User received event: {event.event_name} from {event.source_id}")
        if event.payload:
            print(f"  Payload: {event.payload}")
        received_messages.append(event)
        if event.source_id == "charlie":
            message_received_event.set()

    # Register handler to capture Charlie's response
    user_client.register_event_handler(
        message_handler,
        ["agent.message", "thread.direct_message.notification", "thread.reply.notification", "thread.channel_message.notification"]
    )

    # Give time for handler registration to be processed
    await asyncio.sleep(1.0)

    # Send a direct message to Charlie using agent.message event
    direct_message = Event(
        event_name="agent.message",
        source_id="test_user",
        destination_id="charlie",
        payload={
            "text": "Hi Charlie! This is a private message. Can you tell me about OpenAgents?",
            "message_type": "direct_message",
        },
    )

    print("Sending direct message to Charlie: 'Hi Charlie! This is a private message...'")
    response = await user_client.send_event(direct_message)

    if response:
        print(f"Direct message sent, response: success={response.success}")
    else:
        print("Direct message sent (no immediate response)")

    # Wait for Charlie to process and respond using async event
    max_wait_seconds = 60
    charlie_response_found = False

    try:
        await asyncio.wait_for(message_received_event.wait(), timeout=max_wait_seconds)
        charlie_response_found = True
        print(f"Charlie responded!")
    except asyncio.TimeoutError:
        print(f"Timeout waiting for Charlie's response after {max_wait_seconds}s")

    # Verify Charlie responded
    assert charlie_response_found, (
        f"Charlie should have responded to the direct message within {max_wait_seconds}s. "
        f"Received {len(received_messages)} messages total: {[m.source_id for m in received_messages]}"
    )

    # Get Charlie's response
    charlie_responses = [
        msg for msg in received_messages
        if msg.source_id == "charlie"
    ]

    assert len(charlie_responses) >= 1, "Should have received at least one response from Charlie"

    response_msg = charlie_responses[0]
    print(f"Charlie's response event: {response_msg.event_name}")
    print(f"Charlie's response payload: {response_msg.payload}")

    # Verify the response has text content
    response_text = None
    if response_msg.payload:
        response_text = response_msg.payload.get("text") or response_msg.payload.get("content", {}).get("text")

    assert response_text and len(response_text) > 0, (
        f"Charlie's response should have non-empty text content. Payload: {response_msg.payload}"
    )

    print(f"Charlie's response: '{response_text}'")
    print("test_charlie_responds_to_direct_message PASSED")


@pytest.mark.asyncio
@pytest.mark.integration
@skip_without_api_key()
async def test_charlie_does_not_respond_to_own_messages(charlie_agent, user_client, hello_world_network):
    """Test that Charlie does not respond to its own messages (avoid loops).

    The AgentRunner has logic to skip self-sent messages. This test verifies
    that Charlie doesn't enter an infinite loop responding to itself.
    """
    network, config, grpc_port, http_port = hello_world_network

    print("Testing Charlie does not respond to own messages...")

    # Track all messages
    all_messages: List[Event] = []

    async def message_handler(event: Event):
        all_messages.append(event)

    user_client.register_event_handler(message_handler, ["agent.message"])

    # First, trigger Charlie to respond
    initial_message = Event(
        event_name="agent.message",
        source_id="test_user",
        destination_id="charlie",
        payload={
            "text": "Hello Charlie!",
            "message_type": "direct_message",
        },
    )

    print("Sending initial message to trigger Charlie...")
    await user_client.send_event(initial_message)

    # Wait for Charlie to respond
    await asyncio.sleep(30)

    # Count messages from Charlie
    charlie_messages = [msg for msg in all_messages if msg.source_id == "charlie"]

    print(f"Total messages from Charlie: {len(charlie_messages)}")

    # Charlie should respond once (or a small number of times)
    # If there's a loop, we'd see many more messages
    # Allow up to 3 messages (initial response + possible acknowledgment)
    assert len(charlie_messages) <= 3, (
        f"Charlie sent {len(charlie_messages)} messages, which suggests a potential self-response loop. "
        f"Expected at most 3 messages."
    )

    print("test_charlie_does_not_respond_to_own_messages PASSED")


@pytest.mark.asyncio
@pytest.mark.integration
@skip_without_api_key()
async def test_charlie_conversation_flow(charlie_agent, user_client, hello_world_network):
    """Test a multi-turn conversation with Charlie.

    This test verifies that Charlie can maintain a coherent conversation
    across multiple message exchanges.
    """
    network, config, grpc_port, http_port = hello_world_network

    print("Testing multi-turn conversation with Charlie...")

    received_messages: List[Event] = []
    response_count = 0
    response_event = asyncio.Event()

    async def message_handler(event: Event):
        nonlocal response_count
        received_messages.append(event)
        if event.source_id == "charlie":
            response_count += 1
            response_event.set()

    user_client.register_event_handler(
        message_handler,
        ["agent.message", "thread.direct_message.notification", "thread.reply.notification", "thread.channel_message.notification"]
    )

    # Give time for handler registration
    await asyncio.sleep(1.0)

    # First message
    message1 = Event(
        event_name="agent.message",
        source_id="test_user",
        destination_id="charlie",
        payload={
            "text": "Hi Charlie! What's your name?",
            "message_type": "direct_message",
        },
    )

    print("Turn 1: 'Hi Charlie! What's your name?'")
    await user_client.send_event(message1)

    # Wait for first response using async event
    try:
        await asyncio.wait_for(response_event.wait(), timeout=60)
        response_event.clear()
    except asyncio.TimeoutError:
        pass

    # Check first response
    charlie_responses_1 = [msg for msg in received_messages if msg.source_id == "charlie"]
    assert len(charlie_responses_1) >= 1, "Charlie should respond to first message"

    first_response_payload = charlie_responses_1[0].payload
    first_response = first_response_payload.get("text") or first_response_payload.get("content", {}).get("text", "")
    print(f"Charlie's first response: '{first_response[:100] if first_response else 'N/A'}...'")

    # Second message - follow-up
    message2 = Event(
        event_name="agent.message",
        source_id="test_user",
        destination_id="charlie",
        payload={
            "text": "Nice to meet you! What can you help me with?",
            "message_type": "direct_message",
        },
    )

    print("Turn 2: 'Nice to meet you! What can you help me with?'")
    await user_client.send_event(message2)

    # Wait for second response
    try:
        await asyncio.wait_for(response_event.wait(), timeout=60)
    except asyncio.TimeoutError:
        pass

    # Check second response
    charlie_responses_2 = [msg for msg in received_messages if msg.source_id == "charlie"]
    assert len(charlie_responses_2) >= 2, "Charlie should respond to second message"

    second_response_payload = charlie_responses_2[-1].payload
    second_response = second_response_payload.get("text") or second_response_payload.get("content", {}).get("text", "")
    print(f"Charlie's second response: '{second_response[:100] if second_response else 'N/A'}...'")

    print("test_charlie_conversation_flow PASSED")


@pytest.mark.asyncio
async def test_network_starts_without_api_key(hello_world_network):
    """Test that the network can start even without an API key.

    The API key is only needed when Charlie tries to call the LLM.
    This test verifies the basic network infrastructure works.
    """
    network, config, grpc_port, http_port = hello_world_network

    print("Testing network starts without API key requirement...")

    # Verify network is running
    assert network is not None, "Network should be created"
    assert grpc_port > 0, "gRPC port should be assigned"
    assert http_port > 0, "HTTP port should be assigned"

    # Verify we can connect a client
    client = AgentClient(agent_id="test_network_client")
    connected = await client.connect("localhost", http_port)

    assert connected, "Client should be able to connect to network"
    assert client.connector is not None, "Client should have an active connector"

    await client.disconnect()

    print("test_network_starts_without_api_key PASSED")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])
