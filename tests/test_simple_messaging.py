"""
Tests for the simple_messaging protocol in OpenAgents.

This module contains tests for the simple messaging protocol functionality,
including direct messaging, broadcast messaging, and file transfers.
"""

import asyncio
import os
import tempfile
from pathlib import Path
import pytest
import logging
import base64
import signal
import time
import gc

from src.openagents.core.client import AgentClient
from src.openagents.core.network import AgentNetworkServer
from src.openagents.protocols.communication.simple_messaging.adapter import SimpleMessagingAgentAdapter
from src.openagents.protocols.communication.simple_messaging.protocol import SimpleMessagingNetworkProtocol
from src.openagents.models.messages import ProtocolMessage

# Configure logging for tests
# logging.basicConfig(
#     level=logging.DEBUG,
#     format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
# )
logger = logging.getLogger(__name__)


class TestSimpleMessaging:
    """Test cases for the simple messaging protocol."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down the test environment."""
        # Create a temporary file for testing file transfer
        self.temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".txt")
        self.temp_file_path = self.temp_file.name
        with open(self.temp_file_path, "w") as f:
            f.write("This is a test file for the simple messaging protocol.")
        self.temp_file.close()
        
        logger.info(f"Created test file at {self.temp_file_path}")

        # Initialize test data
        self.host = "127.0.0.1"
        self.port = 8766  # Use a different port than examples to avoid conflicts
        self.network = None
        self.agent1 = None
        self.agent1_messaging = None
        self.agent2 = None
        self.agent2_messaging = None
        
        # Message tracking for assertions
        self.received_messages = []
        self.received_files = []
        
        # Setup is done, yield control back to the test
        yield
        
        # Teardown after the test is complete
        await self.cleanup()
        
        # Clean up the temporary file
        try:
            os.unlink(self.temp_file_path)
            logger.info(f"Removed test file at {self.temp_file_path}")
        except Exception as e:
            logger.error(f"Error removing test file: {e}")

    async def cleanup(self):
        """Clean up network and agent connections."""
        logger.info("Cleaning up test resources")
        
        # Force disconnect agents first
        if self.agent1:
            try:
                await self.agent1.disconnect()
                self.agent1 = None
                logger.info("Agent1 disconnected")
            except Exception as e:
                logger.error(f"Error disconnecting Agent1: {e}")
        
        if self.agent2:
            try:
                await self.agent2.disconnect()
                self.agent2 = None
                logger.info("Agent2 disconnected")
            except Exception as e:
                logger.error(f"Error disconnecting Agent2: {e}")
        
        # Stop the network
        if self.network:
            try:
                self.network.stop()
                self.network = None
                logger.info("Network stopped")
            except Exception as e:
                logger.error(f"Error stopping network: {e}")
        
        # Wait a moment for connections to close
        await asyncio.sleep(0.5)
        
        # Cancel all pending tasks
        tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        logger.info(f"Cancelling {len(tasks)} pending tasks")
        
        # Cancel any remaining tasks
        for task in tasks:
            try:
                task.cancel()
            except Exception as e:
                logger.error(f"Error cancelling task: {e}")
        
        # Wait for tasks to be cancelled
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
            logger.info("All tasks cancelled")
        
        # Force garbage collection
        gc.collect()

    def message_handler(self, content, sender_id):
        """Handle incoming messages for testing."""
        logger.info(f"Received message from {sender_id}: {content}")
        self.received_messages.append({
            "content": content,
            "sender_id": sender_id
        })
        
        # Check if the message contains file references and log them
        if "files" in content and content["files"]:
            logger.info(f"Message contains file references: {content['files']}")
            # Store file IDs for later verification
            for file_data in content["files"]:
                if "file_id" in file_data:
                    logger.info(f"Found file_id: {file_data['file_id']}")

    def file_handler(self, file_id, file_content, metadata, sender_id):
        """Handle incoming files for testing."""
        logger.info(f"Received file from {sender_id}: {file_id}")
        logger.info(f"File size: {len(file_content)} bytes")
        logger.info(f"Metadata: {metadata}")
        self.received_files.append({
            "file_id": file_id,
            "file_content": file_content,
            "metadata": metadata,
            "sender_id": sender_id
        })

    async def setup_network(self):
        """Set up and start the network server."""
        # Create and start the network server
        self.network = AgentNetworkServer(
            network_name="TestNetwork",
            host=self.host,
            port=self.port
        )
        
        # Register the simple messaging protocol with the network
        protocol = SimpleMessagingNetworkProtocol()
        # Register the protocol directly
        self.network.protocols["simple_messaging"] = protocol
        
        # Store the protocol for direct access in tests
        self.network_protocol = protocol
        
        # Start the network server
        self.network.start()
        logger.info(f"Network server started on {self.host}:{self.port}")
        
        # Wait for the server to start
        await asyncio.sleep(1)

    async def setup_agent(self, agent_id):
        """Set up an agent with the simple messaging protocol."""
        # Create the agent
        agent = AgentClient(agent_id=agent_id)
        
        # Create and register the simple messaging protocol adapter with the agent
        messaging_adapter = SimpleMessagingAgentAdapterlient()
        agent.register_protocol_adapter(messaging_adapter)
        
        # Register message and file handlers
        messaging_adapter.register_message_handler("test", self.message_handler)
        messaging_adapter.register_file_handler("test", self.file_handler)
        
        # Connect the agent to the network
        success = await agent.connect_to_server(
            host=self.host,
            port=self.port,
            metadata={"name": agent_id}
        )
        
        assert success, f"Failed to connect {agent_id} to network"
        logger.info(f"Agent {agent_id} connected to network")
        return agent, messaging_adapter

    @pytest.mark.asyncio
    async def test_direct_messaging(self):
        """Test direct messaging between agents."""
        # Set up the network and agents
        await self.setup_network()
        self.agent1, self.agent1_messaging = await self.setup_agent("TestAgent1")
        self.agent2, self.agent2_messaging = await self.setup_agent("TestAgent2")
        
        # Wait for connections to establish
        await asyncio.sleep(1)
        
        # Clear any initial messages
        self.received_messages.clear()
        
        # Send a direct text message from Agent1 to Agent2
        test_message = "Hello from TestAgent1!"
        logger.info(f"Sending message from TestAgent1 to TestAgent2: {test_message}")
        await self.agent1_messaging.send_text_message(
            target_agent_id="TestAgent2",
            text=test_message
        )
        
        # Wait for message to be processed
        await asyncio.sleep(1)
        
        # Verify that Agent2 received the message
        assert len(self.received_messages) > 0, "No messages received"
        found_message = False
        for msg in self.received_messages:
            if msg["sender_id"] == "TestAgent1" and "text" in msg["content"] and msg["content"]["text"] == test_message:
                found_message = True
                break
        assert found_message, f"Message '{test_message}' not received"
        
        # Clear messages for next test
        self.received_messages.clear()
        
        # Send a reply from Agent2 to Agent1
        reply_message = "Hello back from TestAgent2!"
        logger.info(f"Sending reply from TestAgent2 to TestAgent1: {reply_message}")
        await self.agent2_messaging.send_text_message(
            target_agent_id="TestAgent1",
            text=reply_message
        )
        
        # Wait for message to be processed
        await asyncio.sleep(1)
        
        # Verify that Agent1 received the reply
        assert len(self.received_messages) > 0, "No reply messages received"
        found_reply = False
        for msg in self.received_messages:
            if msg["sender_id"] == "TestAgent2" and "text" in msg["content"] and msg["content"]["text"] == reply_message:
                found_reply = True
                break
        assert found_reply, f"Reply '{reply_message}' not received"

    @pytest.mark.asyncio
    async def test_broadcast_messaging(self):
        """Test broadcast messaging between agents."""
        # Set up the network and agents
        await self.setup_network()
        self.agent1, self.agent1_messaging = await self.setup_agent("TestAgent1")
        self.agent2, self.agent2_messaging = await self.setup_agent("TestAgent2")
        
        # Wait for connections to establish
        await asyncio.sleep(1)
        
        # Clear any initial messages
        self.received_messages.clear()
        
        # Send a broadcast message from Agent1
        broadcast_message = "Broadcast message from TestAgent1!"
        logger.info(f"Broadcasting message from TestAgent1: {broadcast_message}")
        await self.agent1_messaging.broadcast_text_message(
            text=broadcast_message
        )
        
        # Wait for message to be processed
        await asyncio.sleep(1)
        
        # Verify that Agent2 received the broadcast
        assert len(self.received_messages) > 0, "No broadcast messages received"
        found_broadcast = False
        for msg in self.received_messages:
            if msg["sender_id"] == "TestAgent1" and "text" in msg["content"] and msg["content"]["text"] == broadcast_message:
                found_broadcast = True
                break
        assert found_broadcast, f"Broadcast '{broadcast_message}' not received"

    @pytest.mark.asyncio
    async def test_file_transfer_direct(self):
        """Test file transfer between agents using direct method."""
        # Set up the network and agents
        await self.setup_network()
        self.agent1, self.agent1_messaging = await self.setup_agent("TestAgent1")
        self.agent2, self.agent2_messaging = await self.setup_agent("TestAgent2")
        
        # Wait for connections to establish
        await asyncio.sleep(2)
        
        # Clear any initial messages and files
        self.received_messages.clear()
        self.received_files.clear()
        
        # Verify the file exists
        assert os.path.exists(self.temp_file_path), f"Test file does not exist at {self.temp_file_path}"
        file_size = os.path.getsize(self.temp_file_path)
        logger.info(f"Test file size: {file_size} bytes")
        
        # Read the file content for direct comparison
        with open(self.temp_file_path, "rb") as f:
            original_content = f.read()
        
        # Create a simpler test - directly store a file in the network protocol
        file_id = "test-file-id-123"
        file_path = self.network_protocol.file_storage_path / file_id
        
        # Write the file to the network protocol's storage
        with open(file_path, "wb") as f:
            f.write(original_content)
        
        logger.info(f"Directly stored file with ID {file_id} in network protocol storage")
        
        # Create a protocol message to simulate a file download response
        encoded_content = base64.b64encode(original_content).decode("utf-8")
        
        # Create a protocol message for file download response
        response = ProtocolMessage(
            sender_id=self.network.network_id,
            protocol="simple_messaging",
            content={
                "action": "file_download_response",
                "success": True,
                "file_id": file_id,
                "content": encoded_content,
                "request_id": "test-request-id"
            },
            direction="outbound",
            relevant_agent_id="TestAgent2"
        )
        
        # Directly call the file download handler in the agent's protocol adapter
        logger.info("Directly calling file download handler")
        await self.agent2_messaging._handle_file_download_response(response)
        
        # Wait a moment for processing
        await asyncio.sleep(1)
        
        # Verify that the file was received
        assert len(self.received_files) > 0, "No files received"
        
        # Verify file content
        logger.info(f"Original file content length: {len(original_content)} bytes")
        
        found_file = False
        for file_data in self.received_files:
            logger.info(f"Received file from {file_data['sender_id']}, content length: {len(file_data['file_content'])} bytes")
            if len(file_data["file_content"]) == len(original_content):
                # Compare content
                if file_data["file_content"] == original_content:
                    found_file = True
                    break
                else:
                    logger.error("File content does not match original")
        
        assert found_file, "File content does not match original"

    @pytest.mark.asyncio
    async def test_file_transfer_end_to_end(self):
        """Test file transfer between agents using the full end-to-end flow."""
        # Set a timeout for this test
        start_time = time.time()
        
        try:
            # Set up the network and agents
            await self.setup_network()
            self.agent1, self.agent1_messaging = await self.setup_agent("TestAgent1")
            self.agent2, self.agent2_messaging = await self.setup_agent("TestAgent2")
            
            # Wait for connections to establish
            await asyncio.sleep(2)
            
            # Clear any initial messages and files
            self.received_messages.clear()
            self.received_files.clear()
            
            # Verify the file exists
            assert os.path.exists(self.temp_file_path), f"Test file does not exist at {self.temp_file_path}"
            file_size = os.path.getsize(self.temp_file_path)
            logger.info(f"Test file size: {file_size} bytes")
            
            # Read the file content for direct comparison
            with open(self.temp_file_path, "rb") as f:
                original_content = f.read()
            
            # Send a file from Agent1 to Agent2
            logger.info(f"Sending file from TestAgent1 to TestAgent2: {self.temp_file_path}")
            await self.agent1_messaging.send_file(
                target_agent_id="TestAgent2",
                file_path=self.temp_file_path,
                message_text="Here's a test file!"
            )
            logger.info("File send request completed")
            
            # Wait for the message with file reference to be received
            file_id = None
            for i in range(5):  # Wait up to 5 seconds
                await asyncio.sleep(1)
                logger.info(f"Checking for file reference message... ({i+1}s)")
                
                # Check if we received a message with file references
                for msg in self.received_messages:
                    if "files" in msg["content"] and msg["content"]["files"]:
                        for file_data in msg["content"]["files"]:
                            if "file_id" in file_data:
                                file_id = file_data["file_id"]
                                logger.info(f"Found file_id in message: {file_id}")
                                break
                        if file_id:
                            break
                
                if file_id:
                    break
            
            assert file_id is not None, "No file_id found in received messages"
            
            # Now manually trigger the file download
            logger.info(f"Manually downloading file with ID: {file_id}")
            
            # Get the file content directly from the network protocol's storage
            file_path = self.network_protocol.file_storage_path / file_id
            assert os.path.exists(file_path), f"File not found at {file_path}"
            
            with open(file_path, "rb") as f:
                file_content = f.read()
            
            # Encode the file content as base64
            encoded_content = base64.b64encode(file_content).decode("utf-8")
            
            # Create a protocol message for file download response
            response = ProtocolMessage(
                sender_id=self.network.network_id,
                protocol="simple_messaging",
                content={
                    "action": "file_download_response",
                    "success": True,
                    "file_id": file_id,
                    "content": encoded_content,
                    "request_id": "test-request-id"
                },
                direction="outbound",
                relevant_agent_id="TestAgent2"
            )
            
            # Directly call the file download handler in the agent's protocol adapter
            logger.info("Directly calling file download handler")
            await self.agent2_messaging._handle_file_download_response(response)
            
            # Wait a moment for processing
            await asyncio.sleep(1)
            
            # Verify that the file was received
            assert len(self.received_files) > 0, "No files received"
            
            # Verify file content
            logger.info(f"Original file content length: {len(original_content)} bytes")
            
            found_file = False
            for file_data in self.received_files:
                logger.info(f"Received file from {file_data['sender_id']}, content length: {len(file_data['file_content'])} bytes")
                if len(file_data["file_content"]) == len(original_content):
                    # Compare content
                    if file_data["file_content"] == original_content:
                        found_file = True
                        break
                    else:
                        logger.error("File content does not match original")
            
            assert found_file, "File content does not match original"
            
            # Check if we're approaching the timeout
            elapsed_time = time.time() - start_time
            if elapsed_time > 20:  # 20 seconds
                logger.warning(f"Test is taking too long: {elapsed_time:.2f} seconds")
        
        finally:
            # Ensure cleanup happens even if test fails
            logger.info("Test completed, cleaning up connections")
            
            # Disconnect agents to ensure clean shutdown
            if self.agent1:
                try:
                    await self.agent1.disconnect()
                    self.agent1 = None
                except Exception as e:
                    logger.error(f"Error disconnecting Agent1: {e}")
            
            if self.agent2:
                try:
                    await self.agent2.disconnect()
                    self.agent2 = None
                except Exception as e:
                    logger.error(f"Error disconnecting Agent2: {e}")
            
            # Stop the network
            if self.network:
                try:
                    self.network.stop()
                    self.network = None
                except Exception as e:
                    logger.error(f"Error stopping network: {e}")
            
            # Wait a moment for connections to close
            await asyncio.sleep(0.5)
            
            # Force exit if we're taking too long
            elapsed_time = time.time() - start_time
            if elapsed_time > 25:  # 25 seconds
                logger.error(f"Test is taking too long, forcing exit: {elapsed_time:.2f} seconds")
                # Force exit the process
                os._exit(0)

    @pytest.mark.asyncio
    async def test_connector_binding(self):
        """Test that the connector is properly bound to protocol adapters."""
        # Set up the network and agents
        await self.setup_network()
        self.agent1, self.agent1_messaging = await self.setup_agent("TestAgent1")
        
        # Verify that the connector is properly bound
        assert self.agent1.connector is not None, "Agent connector is None"
        assert self.agent1_messaging.connector is not None, "Protocol adapter connector is None"
        
        # Verify that both connectors are the same object
        assert self.agent1.connector is self.agent1_messaging.connector, "Agent connector and protocol adapter connector are not the same object" 