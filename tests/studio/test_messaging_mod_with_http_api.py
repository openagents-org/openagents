#!/usr/bin/env python3
"""
Comprehensive HTTP API test suite for the Thread Messaging mod.

This test suite covers all messaging functionality using HTTP API endpoints:
1. Channel message posting and receiving (polling + retrieval)
2. Direct message sending and receiving (polling + retrieval)
3. Self-reply messaging and threading
4. Cross-client reply messaging
5. Message reactions and notifications
6. File upload and download operations with content integrity verification

Usage:
    # Run all tests
    pytest tests/studio/test_messaging_mod_with_http_api.py -v
    
    # Run specific test methods
    pytest tests/studio/test_messaging_mod_with_http_api.py::TestMessagingFlow::test_channel_message_flow -v
    pytest tests/studio/test_messaging_mod_with_http_api.py::TestMessagingFlow::test_file_operations_flow -v
    
    # Run as standalone script
    python tests/studio/test_messaging_mod_with_http_api.py
"""

import pytest
import aiohttp
import time
import json
import random
import string
import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional

from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config

# Configure logging to file
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/tmp/test_messaging_mod_with_http_api.log'),
        logging.StreamHandler()  # Also print to console
    ]
)
logger = logging.getLogger(__name__)


class HTTPClient:
    """HTTP client for testing the OpenAgents messaging mod API."""
    
    def __init__(self, base_url: str, agent_id: str):
        self.base_url = base_url.rstrip('/')
        self.agent_id = agent_id
        self.session = None
        self.registered = False
        
    async def __aenter__(self):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            self.session = None
            
    async def ensure_session(self):
        """Ensure session is created if not already created."""
        if self.session is None:
            self.session = aiohttp.ClientSession()
            
    async def close(self):
        """Close the session."""
        if self.session:
            await self.session.close()
            self.session = None
        
    async def register(self) -> bool:
        """Register the agent with the network."""
        await self.ensure_session()
        url = f"{self.base_url}/api/register"
        payload = {
            "agent_id": self.agent_id,
            "metadata": {
                "display_name": self.agent_id,
                "user_agent": "Python Test Client",
                "platform": "test"
            }
        }
        
        # Retry logic for registration
        for attempt in range(3):
            try:
                logger.info(f"📤 {self.agent_id}: POST {url} (attempt {attempt + 1})")
                logger.info(f"📋 Request payload: {json.dumps(payload, indent=2)}")
                
                # Add a small delay between attempts
                if attempt > 0:
                    await asyncio.sleep(5)
                
                async with self.session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as response:
                    logger.info(f"📥 Response status: {response.status}")
                    logger.info(f"📋 Response headers: {dict(response.headers)}")
                    
                    response.raise_for_status()
                    result = await response.json()
                    
                    logger.info(f"📋 Response body: {json.dumps(result, indent=2)}")
                    
                    if result.get("success", False):
                        self.registered = True
                        print(f"✅ {self.agent_id}: Registered successfully on attempt {attempt + 1}")
                        return True
                    else:
                        print(f"❌ {self.agent_id}: Registration failed on attempt {attempt + 1} - {result.get('message', 'Unknown error')}")
                        if attempt == 2:  # Last attempt
                            return False
                    
            except Exception as e:
                logger.error(f"❌ {self.agent_id}: Registration error on attempt {attempt + 1} - {e}")
                print(f"❌ {self.agent_id}: Registration error on attempt {attempt + 1} - {e}")
                if attempt == 2:  # Last attempt
                    return False
        
        return False
    
    async def unregister(self) -> bool:
        """Unregister the agent from the network."""
        try:
            self.registered = False
            print(f"✅ {self.agent_id}: Marked as unregistered (cleanup)")
            return True
        except Exception as e:
            print(f"❌ {self.agent_id}: Unregistration error - {e}")
            return False
    
    def generate_event_id(self) -> str:
        """Generate a unique event ID."""
        timestamp = int(time.time() * 1000)
        random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))
        return f"{self.agent_id}_{timestamp}_{random_suffix}"
    
    async def send_event(self, event_name: str, payload: Dict[str, Any], 
                   target_agent_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Send an event to the network."""
        await self.ensure_session()
        url = f"{self.base_url}/api/send_event"
        
        event_payload = {
            "event_id": self.generate_event_id(),
            "event_name": event_name,
            "source_id": self.agent_id,
            "payload": payload,
            "metadata": {},
            "visibility": "network"
        }
        
        if target_agent_id:
            event_payload["target_agent_id"] = target_agent_id
            
        try:
            logger.info(f"📤 {self.agent_id}: POST {url}")
            logger.info(f"📋 Request payload: {json.dumps(event_payload, indent=2)}")
            
            async with self.session.post(url, json=event_payload, timeout=aiohttp.ClientTimeout(total=30)) as response:
                logger.info(f"📥 Response status: {response.status}")
                logger.info(f"📋 Response headers: {dict(response.headers)}")
                
                response.raise_for_status()
                result = await response.json()
                
                logger.info(f"📋 Response body: {json.dumps(result, indent=2)}")
                
                if result.get("success", False):
                    print(f"✅ {self.agent_id}: Sent {event_name} successfully")
                    return result
                else:
                    print(f"❌ {self.agent_id}: Failed to send {event_name} - {result.get('message', 'Unknown error')}")
                    return None
                
        except Exception as e:
            logger.error(f"❌ {self.agent_id}: Error sending {event_name} - {e}")
            print(f"❌ {self.agent_id}: Error sending {event_name} - {e}")
            return None
    
    async def send_channel_message(self, channel: str, text: str) -> Optional[Dict[str, Any]]:
        """Send a message to a channel."""
        payload = {
            "channel": channel,
            "text": text,
            "message_type": "channel_message"
        }
        return await self.send_event("thread.channel_message.post", payload, target_agent_id=f"channel:{channel}")
    
    async def send_direct_message(self, target_agent_id: str, text: str) -> Optional[Dict[str, Any]]:
        """Send a direct message to another agent."""
        payload = {
            "target_agent_id": target_agent_id,
            "text": text,
            "message_type": "direct_message"
        }
        return await self.send_event("thread.direct_message.send", payload, target_agent_id=f"agent:{target_agent_id}")
    
    async def send_reply_message(self, channel: str, text: str, reply_to_id: str) -> Optional[Dict[str, Any]]:
        """Send a reply to a message in a channel."""
        payload = {
            "channel": channel,
            "text": text,
            "message_type": "reply_message",
            "reply_to_id": reply_to_id
        }
        return await self.send_event("thread.reply.sent", payload, target_agent_id=f"channel:{channel}")
    
    async def add_reaction(self, target_message_id: str, reaction_type: str, channel: str = "general") -> Optional[Dict[str, Any]]:
        """Add a reaction to a message."""
        payload = {
            "target_message_id": target_message_id,
            "reaction_type": reaction_type,
            "action": "add"
        }
        return await self.send_event("thread.reaction.add", payload, target_agent_id=f"channel:{channel}")
    
    async def get_channels(self) -> Optional[List[Dict[str, Any]]]:
        """Get list of available channels."""
        payload = {}
        result = await self.send_event("thread.channels.list", payload, target_agent_id="mod:openagents.mods.workspace.messaging")
        
        if result and result.get("data", {}).get("channels"):
            return result["data"]["channels"]
        return None
    
    async def get_channel_messages(self, channel: str, limit: int = 50, offset: int = 0) -> Optional[List[Dict[str, Any]]]:
        """Retrieve messages from a channel."""
        payload = {
            "channel": channel,
            "limit": limit,
            "offset": offset
        }
        result = await self.send_event("thread.channel_messages.retrieve", payload, target_agent_id="mod:openagents.mods.workspace.messaging")
        
        if result and result.get("data", {}).get("messages"):
            return result["data"]["messages"]
        return []
    
    async def get_direct_messages(self, target_agent_id: str, limit: int = 50, offset: int = 0) -> Optional[List[Dict[str, Any]]]:
        """Retrieve direct messages with another agent."""
        payload = {
            "target_agent_id": target_agent_id,
            "limit": limit,
            "offset": offset
        }
        result = await self.send_event("thread.direct_messages.retrieve", payload, target_agent_id="mod:openagents.mods.workspace.messaging")
        
        if result and result.get("data", {}).get("messages"):
            return result["data"]["messages"]
        return []
    
    async def poll_messages(self) -> List[Dict[str, Any]]:
        """Poll for new messages."""
        await self.ensure_session()
        url = f"{self.base_url}/api/poll"
        params = {"agent_id": self.agent_id}
        
        try:
            logger.info(f"📤 {self.agent_id}: GET {url}")
            logger.info(f"📋 Request params: {params}")
            
            async with self.session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as response:
                logger.info(f"📥 Response status: {response.status}")
                logger.info(f"📋 Response headers: {dict(response.headers)}")
                
                response.raise_for_status()
                result = await response.json()
                
                logger.info(f"📋 Response body: {json.dumps(result, indent=2)}")
                
                if result.get("success", False) and "messages" in result:
                    messages = result["messages"]
                    if messages:
                        print(f"📨 {self.agent_id}: Received {len(messages)} message(s) via polling")
                        logger.info(f"📨 {self.agent_id}: Received {len(messages)} message(s) via polling")
                    return messages
                
                return []
            
        except Exception as e:
            logger.error(f"❌ {self.agent_id}: Polling error - {e}")
            print(f"❌ {self.agent_id}: Polling error - {e}")
            return []
    
    async def upload_file(self, filename: str, file_content: bytes, mime_type: str = "text/plain") -> Optional[Dict[str, Any]]:
        """Upload a file to the network."""
        import base64
        # Encode file content to base64
        encoded_content = base64.b64encode(file_content).decode('utf-8')
        
        payload = {
            "filename": filename,
            "file_content": encoded_content,
            "mime_type": mime_type,
            "file_size": len(file_content),
            "message_type": "file_upload"
        }
        return await self.send_event("thread.file.upload", payload)
    
    async def download_file(self, file_id: str) -> Optional[Dict[str, Any]]:
        """Download a file from the network."""
        payload = {
            "file_id": file_id,
            "message_type": "file_download"
        }
        return await self.send_event("thread.file.download", payload)


@pytest.fixture(scope="function")
async def test_network():
    """Create and start a network using workspace_test.yaml config."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update the HTTP transport port to use random port
    http_port = random.randint(47000, 48000)
    grpc_port = http_port + 100  # Ensure different ports
    
    for transport in config.network.transports:
        if transport.type == "http":
            transport.config["port"] = http_port
        elif transport.type == "grpc":
            transport.config["port"] = grpc_port
    
    # Create and initialize network
    network = create_network(config.network)
    await network.initialize()
    
    # Give network time to start up and mods to initialize
    await asyncio.sleep(5.0)
    
    yield network, http_port
    
    # Cleanup
    try:
        await network.shutdown()
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.fixture
async def base_url(test_network):
    """Base URL for the OpenAgents HTTP API."""
    network, http_port = test_network
    return f"http://localhost:{http_port}"


@pytest.fixture
async def client_a(base_url):
    """Client A for testing."""
    client = HTTPClient(base_url, "ClientA_Test")
    try:
        yield client
    finally:
        if client.registered:
            await client.unregister()
        await client.close()


@pytest.fixture
async def client_b(base_url):
    """Client B for testing."""
    client = HTTPClient(base_url, "ClientB_Test")
    try:
        yield client
    finally:
        if client.registered:
            await client.unregister()
        await client.close()


class TestMessagingFlow:
    """Test comprehensive messaging flow scenarios."""
    
    @pytest.mark.asyncio
    async def test_channel_message_flow(self, client_a, client_b):
        """
        Test: Client A posts a message to general channel and confirm that Client B can 
        receive the message by polling and also thread.channel_messages.retrieve
        """
        print("\n🧪 Test: Channel Message Flow")
        print("-" * 40)
        
        # Add extra delay to ensure network is fully ready
        await asyncio.sleep(5)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Client A sends channel message
        test_message = f"Hello from Client A in general channel! (Test at {int(time.time())})"
        message_result = await client_a.send_channel_message("general", test_message)
        assert message_result is not None, "Channel message sending should succeed"
        
        sent_message_id = message_result.get("data", {}).get("event_id")
        print(f"✅ Channel message sent with ID: {sent_message_id}")
        await asyncio.sleep(3)  # Wait for message propagation
        
        # Client B receives message via polling
        received_messages = await client_b.poll_messages()
        channel_notifications = [msg for msg in received_messages if msg.get("event_name") == "thread.channel_message.notification"]
        
        assert len(channel_notifications) > 0, "Client B should receive channel notifications via polling"
        
        found_via_polling = False
        for msg in channel_notifications:
            payload = msg.get("payload", {})
            received_text = payload.get("text", "")
            if received_text == test_message:
                found_via_polling = True
                assert payload.get("channel") == "general", "Message should be in general channel"
                assert msg.get("source_id") == "ClientA_Test", "Message should be from Client A"
                print(f"✅ Message received via polling: '{received_text}'")
                break
        
        assert found_via_polling, "Should find the sent message via polling"
        
        # Client B retrieves message via API
        retrieved_messages = await client_b.get_channel_messages("general", limit=10)
        assert retrieved_messages is not None, "Should be able to retrieve channel messages"
        assert len(retrieved_messages) > 0, "Should have at least one message"
        
        found_via_retrieval = False
        for msg in retrieved_messages:
            # Message retrieval returns messages with content.text structure
            content = msg.get("content", {})
            text = content.get("text", "")
            sender_id = msg.get("sender_id", "")
            if text == test_message and sender_id == "ClientA_Test":
                found_via_retrieval = True
                print(f"✅ Message found via retrieval: '{text}'")
                break
        
        assert found_via_retrieval, "Should find the sent message via channel retrieval"
    
    @pytest.mark.asyncio
    async def test_direct_message_flow(self, client_a, client_b):
        """
        Test: Client A sends a direct message to Client B and confirm that Client B can 
        receive the message by polling and thread.direct_messages.retrieve
        """
        print("\n🧪 Test: Direct Message Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Client A sends direct message to Client B
        test_message = f"Hello Client B, this is a direct message from Client A! (Test at {int(time.time())})"
        message_result = await client_a.send_direct_message("ClientB_Test", test_message)
        assert message_result is not None, "Direct message sending should succeed"
        
        print(f"✅ Direct message sent to ClientB_Test")
        await asyncio.sleep(3)  # Wait for message propagation
        
        # Client B receives message via polling
        received_messages = await client_b.poll_messages()
        direct_notifications = [msg for msg in received_messages if msg.get("event_name") == "thread.direct_message.notification"]
        
        assert len(direct_notifications) > 0, "Client B should receive direct message notifications via polling"
        
        found_via_polling = False
        for msg in direct_notifications:
            payload = msg.get("payload", {})
            received_text = payload.get("text", "")
            if received_text == test_message:
                found_via_polling = True
                assert payload.get("target_agent_id") == "ClientB_Test", "Message should be targeted to Client B"
                assert msg.get("source_id") == "ClientA_Test", "Message should be from Client A"
                print(f"✅ Direct message received via polling: '{received_text}'")
                break
        
        assert found_via_polling, "Should find the sent direct message via polling"
        
        # Client B retrieves direct messages via API
        retrieved_messages = await client_b.get_direct_messages("ClientA_Test", limit=10)
        assert retrieved_messages is not None, "Should be able to retrieve direct messages"
        assert len(retrieved_messages) > 0, "Should have at least one direct message"
        
        found_via_retrieval = False
        for msg in retrieved_messages:
            # Direct message retrieval returns full event objects with payload.text structure
            payload = msg.get("payload", {})
            text = payload.get("text", "")
            source_id = msg.get("source_id", "")
            if text == test_message and source_id == "ClientA_Test":
                found_via_retrieval = True
                print(f"✅ Direct message found via retrieval: '{text}'")
                break
        
        assert found_via_retrieval, "Should find the sent direct message via retrieval"
    
    @pytest.mark.asyncio
    async def test_self_reply_flow(self, client_a, client_b):
        """
        Test: Client A posts a message to general channel and Client A replies to its own message 
        and confirm that Client B can see the message by polling and also thread.channel_messages.retrieve
        """
        print("\n🧪 Test: Self Reply Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Client A sends original message
        original_message = f"Original message from Client A (Test at {int(time.time())})"
        message_result = await client_a.send_channel_message("general", original_message)
        assert message_result is not None, "Original message sending should succeed"
        
        original_message_id = message_result.get("data", {}).get("event_id")
        print(f"✅ Original message sent with ID: {original_message_id}")
        await asyncio.sleep(2)
        
        # Client A replies to its own message
        reply_message = f"Self-reply from Client A to own message (Test at {int(time.time())})"
        reply_result = await client_a.send_reply_message("general", reply_message, original_message_id)
        assert reply_result is not None, "Self-reply sending should succeed"
        
        print(f"✅ Self-reply sent: '{reply_message}'")
        await asyncio.sleep(3)
        
        # Client B receives reply via polling
        received_messages = await client_b.poll_messages()
        reply_notifications = [msg for msg in received_messages 
                             if msg.get("event_name") in ["thread.reply.notification", "thread.channel_message.notification"]]
        
        assert len(reply_notifications) > 0, "Client B should receive reply notifications via polling"
        
        found_reply_via_polling = False
        for msg in reply_notifications:
            payload = msg.get("payload", {})
            received_text = payload.get("text", "")
            if received_text == reply_message:
                found_reply_via_polling = True
                assert payload.get("channel") == "general", "Reply should be in general channel"
                assert msg.get("source_id") == "ClientA_Test", "Reply should be from Client A"
                print(f"✅ Self-reply received via polling: '{received_text}'")
                break
        
        assert found_reply_via_polling, "Should find the self-reply via polling"
        
        # Client B retrieves messages via API (should see both original and reply)
        retrieved_messages = await client_b.get_channel_messages("general", limit=20)
        assert retrieved_messages is not None, "Should be able to retrieve channel messages"
        
        found_original = False
        found_reply = False
        for msg in retrieved_messages:
            # Message retrieval returns messages with content.text structure
            content = msg.get("content", {})
            text = content.get("text", "")
            sender_id = msg.get("sender_id", "")
            
            if text == original_message and sender_id == "ClientA_Test":
                found_original = True
                print(f"✅ Original message found via retrieval: '{text}'")
            elif text == reply_message and sender_id == "ClientA_Test":
                found_reply = True
                reply_to_id = msg.get("reply_to_id", "")
                # Note: reply_to_id might use message_id instead of event_id
                print(f"✅ Self-reply found via retrieval: '{text}' (reply to {reply_to_id})")
        
        assert found_original, "Should find the original message via retrieval"
        assert found_reply, "Should find the self-reply via retrieval"
    
    @pytest.mark.asyncio
    async def test_cross_client_reply_flow(self, client_a, client_b):
        """
        Test: Client A posts a message to general channel and Client B replies and confirm 
        that Client A can see the message by polling and also thread.channel_messages.retrieve
        """
        print("\n🧪 Test: Cross-Client Reply Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Client A sends original message
        original_message = f"Message from Client A for Client B to reply (Test at {int(time.time())})"
        message_result = await client_a.send_channel_message("general", original_message)
        assert message_result is not None, "Original message sending should succeed"
        
        original_message_id = message_result.get("data", {}).get("event_id")
        print(f"✅ Original message sent with ID: {original_message_id}")
        await asyncio.sleep(2)
        
        # Client B receives original message and gets its ID
        received_messages = await client_b.poll_messages()
        channel_notifications = [msg for msg in received_messages if msg.get("event_name") == "thread.channel_message.notification"]
        
        received_message_id = None
        for msg in channel_notifications:
            payload = msg.get("payload", {})
            if payload.get("text") == original_message:
                received_message_id = msg.get("event_id")
                break
        
        assert received_message_id is not None, "Client B should receive the original message"
        print(f"✅ Client B received original message with ID: {received_message_id}")
        
        # Client B replies to Client A's message
        reply_message = f"Reply from Client B to Client A's message (Test at {int(time.time())})"
        reply_result = await client_b.send_reply_message("general", reply_message, received_message_id)
        assert reply_result is not None, "Cross-client reply sending should succeed"
        
        print(f"✅ Cross-client reply sent: '{reply_message}'")
        await asyncio.sleep(3)
        
        # Client A receives reply via polling
        reply_notifications = await client_a.poll_messages()
        found_reply_via_polling = False
        
        for msg in reply_notifications:
            event_name = msg.get("event_name", "")
            if "reply.notification" in event_name or "channel_message.notification" in event_name:
                payload = msg.get("payload", {})
                received_text = payload.get("text", "")
                if received_text == reply_message:
                    found_reply_via_polling = True
                    assert payload.get("channel") == "general", "Reply should be in general channel"
                    assert msg.get("source_id") == "ClientB_Test", "Reply should be from Client B"
                    print(f"✅ Cross-client reply received via polling: '{received_text}'")
                    break
        
        assert found_reply_via_polling, "Client A should receive the reply via polling"
        
        # Client A retrieves messages via API (should see both original and reply)
        retrieved_messages = await client_a.get_channel_messages("general", limit=20)
        assert retrieved_messages is not None, "Should be able to retrieve channel messages"
        
        found_original = False
        found_reply = False
        for msg in retrieved_messages:
            # Message retrieval returns messages with content.text structure
            content = msg.get("content", {})
            text = content.get("text", "")
            sender_id = msg.get("sender_id", "")
            
            if text == original_message and sender_id == "ClientA_Test":
                found_original = True
                print(f"✅ Original message found via retrieval: '{text}'")
            elif text == reply_message and sender_id == "ClientB_Test":
                found_reply = True
                reply_to_id = msg.get("reply_to_id", "")
                print(f"✅ Cross-client reply found via retrieval: '{text}' (reply to {reply_to_id})")
        
        assert found_original, "Should find the original message via retrieval"
        assert found_reply, "Should find the cross-client reply via retrieval"
    
    @pytest.mark.asyncio
    async def test_reaction_flow(self, client_a, client_b):
        """
        Test: Client A posts a message to general channel and Client B reacts to the message 
        and confirm Client A receives updated message with polling and the reaction shows up with retrieve
        """
        print("\n🧪 Test: Reaction Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Client A sends original message
        original_message = f"Message for reaction testing (Test at {int(time.time())})"
        message_result = await client_a.send_channel_message("general", original_message)
        assert message_result is not None, "Original message sending should succeed"
        
        original_message_id = message_result.get("data", {}).get("event_id")
        print(f"✅ Original message sent with ID: {original_message_id}")
        await asyncio.sleep(2)
        
        # Client B receives original message and gets its ID
        received_messages = await client_b.poll_messages()
        channel_notifications = [msg for msg in received_messages if msg.get("event_name") == "thread.channel_message.notification"]
        
        received_message_id = None
        for msg in channel_notifications:
            payload = msg.get("payload", {})
            if payload.get("text") == original_message:
                received_message_id = msg.get("event_id")
                break
        
        assert received_message_id is not None, "Client B should receive the original message"
        print(f"✅ Client B received original message with ID: {received_message_id}")
        
        # Client B adds reaction to Client A's message
        reaction_result = await client_b.add_reaction(received_message_id, "like", "general")
        assert reaction_result is not None, "Reaction adding should succeed"
        
        print(f"✅ Client B added 'like' reaction to message")
        await asyncio.sleep(3)
        
        # Client A receives reaction notification via polling
        reaction_notifications = await client_a.poll_messages()
        found_reaction_via_polling = False
        
        for msg in reaction_notifications:
            event_name = msg.get("event_name", "")
            if "reaction.notification" in event_name:
                payload = msg.get("payload", {})
                if payload.get("target_message_id") == original_message_id:
                    found_reaction_via_polling = True
                    assert payload.get("reaction_type") == "like", "Reaction type should be 'like'"
                    assert msg.get("source_id") == "ClientB_Test", "Reaction should be from Client B"
                    print(f"✅ Reaction notification received via polling: {payload.get('reaction_type')}")
                    break
        
        assert found_reaction_via_polling, "Client A should receive reaction notification via polling"
        
        # Client A retrieves messages via API (should see original message with reaction)
        retrieved_messages = await client_a.get_channel_messages("general", limit=20)
        assert retrieved_messages is not None, "Should be able to retrieve channel messages"
        
        found_message_with_reaction = False
        for msg in retrieved_messages:
            # Message retrieval returns messages with content.text structure
            content = msg.get("content", {})
            text = content.get("text", "")
            sender_id = msg.get("sender_id", "")
            
            if text == original_message and sender_id == "ClientA_Test":
                reactions = msg.get("reactions", {})
                if reactions and "like" in reactions:
                    found_message_with_reaction = True
                    like_count = reactions.get("like", 0)
                    assert like_count > 0, "Should have at least one 'like' reaction"
                    print(f"✅ Original message found with reactions via retrieval: {reactions}")
                break
        
        assert found_message_with_reaction, "Should find the original message with reactions via retrieval"
    
    @pytest.mark.asyncio
    async def test_file_operations_flow(self, client_a, client_b):
        """
        Test: Client A uploads a file and Client B downloads it, verifying content integrity
        """
        print("\n🧪 Test: File Operations Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Create test file content with various characters
        test_content = f"Test file uploaded at {int(time.time())}\nWith multiple lines\nAnd special characters: éñ中文🚀\nBinary-safe content: \x00\x01\x02\xFF"
        test_bytes = test_content.encode('utf-8')
        filename = f"test_document_{int(time.time())}.txt"
        
        # Client A uploads file
        upload_result = await client_a.upload_file(filename, test_bytes, "text/plain")
        assert upload_result is not None, "File upload should succeed"
        assert upload_result.get("success") == True, "Upload response should indicate success"
        
        # Extract file_id from response
        file_id = None
        if upload_result.get("data") and upload_result["data"].get("file_id"):
            file_id = upload_result["data"]["file_id"]
        
        assert file_id is not None, "Upload should return a valid file_id"
        print(f"✅ File uploaded successfully with ID: {file_id}")
        print(f"   Filename: {filename}")
        print(f"   Size: {len(test_bytes)} bytes")
        
        # Verify file_id is a valid UUID format
        import uuid
        try:
            uuid.UUID(file_id)
            print(f"✅ File ID is valid UUID format")
        except ValueError:
            assert False, f"File ID should be valid UUID format, got: {file_id}"
        
        await asyncio.sleep(1)  # Allow file to be processed
        
        # Client B downloads the file
        download_result = await client_b.download_file(file_id)
        assert download_result is not None, "File download should succeed"
        assert download_result.get("success") == True, "Download response should indicate success"
        
        # Extract file content from response
        download_data = download_result.get("data", {})
        assert download_data.get("success") == True, "Download data should indicate success"
        assert download_data.get("file_id") == file_id, "Downloaded file should have correct file_id"
        assert download_data.get("filename") == filename, "Downloaded file should have correct filename"
        assert download_data.get("mime_type") == "text/plain", "Downloaded file should have correct mime_type"
        
        # Verify content integrity
        import base64
        downloaded_content_b64 = download_data.get("content")
        assert downloaded_content_b64 is not None, "Downloaded file should contain content"
        
        try:
            downloaded_bytes = base64.b64decode(downloaded_content_b64)
            downloaded_content = downloaded_bytes.decode('utf-8')
        except Exception as e:
            assert False, f"Failed to decode downloaded content: {e}"
        
        assert downloaded_content == test_content, "Downloaded content should match original exactly"
        assert len(downloaded_bytes) == len(test_bytes), "Downloaded size should match original size"
        
        print(f"✅ File downloaded successfully by Client B")
        print(f"   Content integrity verified: {len(downloaded_content)} chars match")
        print(f"   Content preview: '{downloaded_content[:50]}...'")
        
        # Test downloading non-existent file
        fake_file_id = "00000000-0000-0000-0000-000000000000"
        error_result = await client_b.download_file(fake_file_id)
        assert error_result is not None, "Should receive response for non-existent file"
        
        error_data = error_result.get("data", {})
        assert error_data.get("success") == False, "Non-existent file download should fail"
        assert "File not found" in error_data.get("error", ""), "Should receive 'File not found' error"
        
        print(f"✅ Non-existent file error handled correctly: {error_data.get('error')}")
        
        # Test multiple file operations
        print("\n📁 Testing multiple file uploads...")
        
        # Upload multiple files of different types
        test_files = [
            ("json_test.json", '{"test": true, "number": 42, "text": "Hello World"}', "application/json"),
            ("markdown_test.md", "# Test Markdown\n\n- Item 1\n- Item 2\n\n**Bold text**", "text/markdown"),
            ("binary_test.bin", bytes([0, 1, 2, 3, 255, 254, 253, 252]), "application/octet-stream")
        ]
        
        uploaded_files = []
        
        for filename, content, mime_type in test_files:
            if isinstance(content, str):
                content_bytes = content.encode('utf-8')
            else:
                content_bytes = content
            
            upload_result = await client_a.upload_file(filename, content_bytes, mime_type)
            assert upload_result is not None, f"Upload should succeed for {filename}"
            
            file_id = upload_result["data"]["file_id"]
            uploaded_files.append((filename, content_bytes, mime_type, file_id))
            print(f"   ✅ Uploaded {filename} ({len(content_bytes)} bytes) -> {file_id}")
        
        # Download and verify all uploaded files
        print("\n📥 Verifying all uploaded files...")
        
        for original_filename, original_content, original_mime_type, file_id in uploaded_files:
            download_result = await client_b.download_file(file_id)
            assert download_result is not None, f"Download should succeed for {original_filename}"
            
            download_data = download_result["data"]
            assert download_data["success"] == True, f"Download should succeed for {original_filename}"
            assert download_data["filename"] == original_filename, f"Filename should match for {original_filename}"
            assert download_data["mime_type"] == original_mime_type, f"MIME type should match for {original_filename}"
            
            # Verify content
            downloaded_bytes = base64.b64decode(download_data["content"])
            assert downloaded_bytes == original_content, f"Content should match for {original_filename}"
            
            print(f"   ✅ Verified {original_filename} - content integrity confirmed")
        
        print(f"\n✅ File operations test completed successfully!")
        print(f"   - Single file upload/download: ✅")
        print(f"   - Content integrity verification: ✅") 
        print(f"   - Error handling (non-existent file): ✅")
        print(f"   - Multiple file types: ✅ ({len(test_files)} files)")
        print(f"   - Binary data support: ✅")


def run_standalone_tests():
    """Run tests when executed as standalone script."""
    print("🚀 Starting Comprehensive Thread Messaging HTTP API Tests")
    print("=" * 70)
    
    async def run_async_tests():
        # Setup dynamic network
        config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
        config = load_network_config(str(config_path))
        
        # Use random port to avoid conflicts
        http_port = random.randint(47000, 48000)
        grpc_port = http_port + 100
        
        for transport in config.network.transports:
            if transport.type == "http":
                transport.config["port"] = http_port
            elif transport.type == "grpc":
                transport.config["port"] = grpc_port
        
        # Create and initialize network
        network = create_network(config.network)
        await network.initialize()
        await asyncio.sleep(1.0)
        
        try:
            # Configuration
            base_url = f"http://localhost:{http_port}"
            
            # Create test instances
            test_messaging = TestMessagingFlow()
            client_a = HTTPClient(base_url, "ClientA_Test")
            client_b = HTTPClient(base_url, "ClientB_Test")
            
            try:
                # Run all messaging flow tests
                print(f"\n🧪 Running Messaging Flow Tests on port {http_port}")
                print("-" * 50)
                
                await test_messaging.test_channel_message_flow(client_a, client_b)
                print("✅ Channel message flow test passed")
                
                await test_messaging.test_direct_message_flow(client_a, client_b)
                print("✅ Direct message flow test passed")
                
                await test_messaging.test_self_reply_flow(client_a, client_b)
                print("✅ Self reply flow test passed")
                
                await test_messaging.test_cross_client_reply_flow(client_a, client_b)
                print("✅ Cross-client reply flow test passed")
                
                await test_messaging.test_reaction_flow(client_a, client_b)
                print("✅ Reaction flow test passed")
                
                await test_messaging.test_file_operations_flow(client_a, client_b)
                print("✅ File operations flow test passed")
                
            finally:
                if client_a.registered:
                    await client_a.unregister()
                if client_b.registered:
                    await client_b.unregister()
        
        finally:
            await network.shutdown()
    
    asyncio.run(run_async_tests())
    print("\n🎉 All comprehensive messaging tests completed successfully!")


if __name__ == "__main__":
    run_standalone_tests()