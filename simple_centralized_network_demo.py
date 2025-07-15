#!/usr/bin/env python3
"""
Simple Centralized Network Demo

This is a standalone demonstration of a centralized network with two agent clients.
It shows:
1. A central server that manages connections and routes messages
2. Two agent clients that connect to the server
3. Message exchange between the agents through the server

This example uses basic Python asyncio and websockets for simplicity.
"""

import asyncio
import json
import logging
import time
import websockets
from typing import Dict, Set, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CentralizedServer:
    """
    A centralized server that manages agent connections and routes messages.
    """
    
    def __init__(self, host: str = "localhost", port: int = 8765):
        self.host = host
        self.port = port
        self.clients: Dict[str, Any] = {}
        self.server = None
        
    async def register_client(self, websocket, agent_id: str):
        """Register a new client connection."""
        self.clients[agent_id] = websocket
        logger.info(f"Client {agent_id} connected. Total clients: {len(self.clients)}")
        
        # Notify other clients about the new connection
        await self.broadcast_system_message(f"Agent {agent_id} joined the network", exclude=agent_id)
    
    async def unregister_client(self, agent_id: str):
        """Unregister a client connection."""
        if agent_id in self.clients:
            del self.clients[agent_id]
            logger.info(f"Client {agent_id} disconnected. Total clients: {len(self.clients)}")
            
            # Notify other clients about the disconnection
            await self.broadcast_system_message(f"Agent {agent_id} left the network", exclude=agent_id)
    
    async def handle_message(self, message: Dict[str, Any], sender_id: str):
        """Handle incoming messages and route them appropriately."""
        message_type = message.get("type")
        
        if message_type == "direct":
            await self.handle_direct_message(message, sender_id)
        elif message_type == "broadcast":
            await self.handle_broadcast_message(message, sender_id)
        else:
            logger.warning(f"Unknown message type: {message_type}")
    
    async def handle_direct_message(self, message: Dict[str, Any], sender_id: str):
        """Handle direct messages between specific agents."""
        recipient_id = message.get("recipient_id")
        
        if recipient_id in self.clients:
            try:
                message["sender_id"] = sender_id
                message["timestamp"] = time.time()
                await self.clients[recipient_id].send(json.dumps(message))
                logger.info(f"Direct message from {sender_id} to {recipient_id}: {message.get('content', '')[:50]}...")
            except Exception as e:
                logger.error(f"Failed to send direct message to {recipient_id}: {e}")
        else:
            logger.warning(f"Recipient {recipient_id} not found for direct message from {sender_id}")
    
    async def handle_broadcast_message(self, message: Dict[str, Any], sender_id: str):
        """Handle broadcast messages to all connected agents."""
        message["sender_id"] = sender_id
        message["timestamp"] = time.time()
        
        recipients = [agent_id for agent_id in self.clients.keys() if agent_id != sender_id]
        logger.info(f"Broadcasting message from {sender_id} to {len(recipients)} recipients")
        
        for recipient_id in recipients:
            try:
                await self.clients[recipient_id].send(json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to broadcast to {recipient_id}: {e}")
    
    async def broadcast_system_message(self, content: str, exclude: str = None):
        """Send a system message to all connected clients."""
        system_message = {
            "type": "system",
            "content": content,
            "sender_id": "server",
            "timestamp": time.time()
        }
        
        for agent_id, websocket in self.clients.items():
            if agent_id != exclude:
                try:
                    await websocket.send(json.dumps(system_message))
                except Exception as e:
                    logger.error(f"Failed to send system message to {agent_id}: {e}")
    
    async def handle_client(self, websocket):
        """Handle a client connection."""
        agent_id = None
        try:
            # Wait for initial registration message
            initial_message = await websocket.recv()
            data = json.loads(initial_message)
            
            if data.get("type") == "register":
                agent_id = data.get("agent_id")
                await self.register_client(websocket, agent_id)
                
                # Send registration confirmation
                confirmation = {
                    "type": "registration_confirmed",
                    "agent_id": agent_id,
                    "timestamp": time.time()
                }
                await websocket.send(json.dumps(confirmation))
                
                # Handle subsequent messages
                async for message in websocket:
                    data = json.loads(message)
                    await self.handle_message(data, agent_id)
            else:
                logger.warning(f"Invalid initial message from client: {data}")
                
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client {agent_id} connection closed")
        except Exception as e:
            logger.error(f"Error handling client {agent_id}: {e}")
        finally:
            if agent_id:
                await self.unregister_client(agent_id)
    
    async def start(self):
        """Start the centralized server."""
        self.server = await websockets.serve(self.handle_client, self.host, self.port)
        logger.info(f"Centralized server started on {self.host}:{self.port}")
    
    async def stop(self):
        """Stop the centralized server."""
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            logger.info("Centralized server stopped")


class AgentClient:
    """
    An agent client that connects to the centralized server.
    """
    
    def __init__(self, agent_id: str, server_host: str = "localhost", server_port: int = 8765):
        self.agent_id = agent_id
        self.server_url = f"ws://{server_host}:{server_port}"
        self.websocket = None
        self.received_messages = []
        self.is_running = False
        
    async def connect(self):
        """Connect to the centralized server."""
        try:
            self.websocket = await websockets.connect(self.server_url)
            
            # Send registration message
            registration = {
                "type": "register",
                "agent_id": self.agent_id
            }
            await self.websocket.send(json.dumps(registration))
            
            # Wait for confirmation
            response = await self.websocket.recv()
            data = json.loads(response)
            
            if data.get("type") == "registration_confirmed":
                logger.info(f"Agent {self.agent_id} successfully connected to server")
                self.is_running = True
                
                # Start message listener
                asyncio.create_task(self.listen_for_messages())
            else:
                logger.error(f"Registration failed for agent {self.agent_id}")
                
        except Exception as e:
            logger.error(f"Failed to connect agent {self.agent_id}: {e}")
    
    async def listen_for_messages(self):
        """Listen for incoming messages from the server."""
        try:
            async for message in self.websocket:
                data = json.loads(message)
                await self.handle_received_message(data)
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Agent {self.agent_id} connection to server closed")
            self.is_running = False
        except Exception as e:
            logger.error(f"Error listening for messages in agent {self.agent_id}: {e}")
            self.is_running = False
    
    async def handle_received_message(self, message: Dict[str, Any]):
        """Handle a received message."""
        self.received_messages.append(message)
        
        message_type = message.get("type")
        sender = message.get("sender_id", "unknown")
        content = message.get("content", "")
        
        if message_type == "direct":
            logger.info(f"Agent {self.agent_id} received direct message from {sender}: {content}")
        elif message_type == "broadcast":
            logger.info(f"Agent {self.agent_id} received broadcast from {sender}: {content}")
        elif message_type == "system":
            logger.info(f"Agent {self.agent_id} received system message: {content}")
        else:
            logger.info(f"Agent {self.agent_id} received {message_type} message from {sender}: {content}")
    
    async def send_direct_message(self, recipient_id: str, content: str):
        """Send a direct message to another agent."""
        if not self.is_running:
            logger.error(f"Agent {self.agent_id} is not connected")
            return
            
        message = {
            "type": "direct",
            "recipient_id": recipient_id,
            "content": content,
            "message_id": f"msg-{int(time.time() * 1000)}"
        }
        
        await self.websocket.send(json.dumps(message))
        logger.info(f"Agent {self.agent_id} sent direct message to {recipient_id}: {content}")
    
    async def send_broadcast_message(self, content: str):
        """Send a broadcast message to all other agents."""
        if not self.is_running:
            logger.error(f"Agent {self.agent_id} is not connected")
            return
            
        message = {
            "type": "broadcast",
            "content": content,
            "message_id": f"broadcast-{int(time.time() * 1000)}"
        }
        
        await self.websocket.send(json.dumps(message))
        logger.info(f"Agent {self.agent_id} sent broadcast message: {content}")
    
    async def disconnect(self):
        """Disconnect from the server."""
        self.is_running = False
        if self.websocket:
            await self.websocket.close()
            logger.info(f"Agent {self.agent_id} disconnected from server")


async def run_demo():
    """
    Run the complete demonstration of centralized network with two agents.
    """
    logger.info("🚀 Starting Centralized Network Demo")
    
    # Create and start the centralized server
    server = CentralizedServer(host="localhost", port=8765)
    await server.start()
    
    # Give server time to start
    await asyncio.sleep(0.5)
    
    try:
        # Create two agent clients
        agent1 = AgentClient("Agent-Alpha")
        agent2 = AgentClient("Agent-Beta")
        
        # Connect both agents to the server
        logger.info("📡 Connecting agents to server...")
        await agent1.connect()
        await agent2.connect()
        
        # Wait for connections to establish
        await asyncio.sleep(1.0)
        
        # Test 1: Direct messaging
        logger.info("\n🔄 Test 1: Direct Messaging")
        await agent1.send_direct_message("Agent-Beta", "Hello Agent Beta! This is Alpha.")
        await asyncio.sleep(1.0)
        
        await agent2.send_direct_message("Agent-Alpha", "Hello Agent Alpha! Nice to meet you!")
        await asyncio.sleep(1.0)
        
        # Test 2: Broadcast messaging
        logger.info("\n📢 Test 2: Broadcast Messaging")
        await agent1.send_broadcast_message("Hello everyone! This is a broadcast from Alpha.")
        await asyncio.sleep(1.0)
        
        # Test 3: Multiple message exchange
        logger.info("\n💬 Test 3: Multiple Message Exchange")
        messages = [
            ("Agent-Alpha", "Agent-Beta", "How are you doing?"),
            ("Agent-Beta", "Agent-Alpha", "I'm doing great! How about you?"),
            ("Agent-Alpha", "Agent-Beta", "Excellent! Ready for more testing?"),
            ("Agent-Beta", "Agent-Alpha", "Absolutely! Let's continue."),
        ]
        
        for sender_name, recipient_name, content in messages:
            if sender_name == "Agent-Alpha":
                await agent1.send_direct_message(recipient_name, content)
            else:
                await agent2.send_direct_message(recipient_name, content)
            await asyncio.sleep(0.5)
        
        # Wait for all messages to be processed
        await asyncio.sleep(2.0)
        
        # Display results
        logger.info("\n📊 Results Summary:")
        logger.info(f"Agent Alpha received {len(agent1.received_messages)} messages:")
        for msg in agent1.received_messages:
            logger.info(f"  - {msg.get('type', 'unknown')} from {msg.get('sender_id', 'unknown')}: {msg.get('content', '')[:50]}...")
        
        logger.info(f"Agent Beta received {len(agent2.received_messages)} messages:")
        for msg in agent2.received_messages:
            logger.info(f"  - {msg.get('type', 'unknown')} from {msg.get('sender_id', 'unknown')}: {msg.get('content', '')[:50]}...")
        
        # Test 4: Resilience test
        logger.info("\n🔧 Test 4: Connection Resilience")
        logger.info("Disconnecting Agent Beta...")
        await agent2.disconnect()
        await asyncio.sleep(1.0)
        
        logger.info("Agent Alpha tries to send message to disconnected Agent Beta...")
        await agent1.send_direct_message("Agent-Beta", "Are you still there, Beta?")
        await asyncio.sleep(1.0)
        
        logger.info("Reconnecting Agent Beta...")
        agent2 = AgentClient("Agent-Beta")  # Create new instance
        await agent2.connect()
        await asyncio.sleep(1.0)
        
        logger.info("Sending message to reconnected Agent Beta...")
        await agent1.send_direct_message("Agent-Beta", "Welcome back, Beta!")
        await asyncio.sleep(1.0)
        
        logger.info("✅ Demo completed successfully!")
        
        # Disconnect all agents
        await agent1.disconnect()
        await agent2.disconnect()
        
    except Exception as e:
        logger.error(f"❌ Demo failed: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # Stop the server
        await server.stop()
        logger.info("🏁 Demo finished")


if __name__ == "__main__":
    # Run the demo
    try:
        asyncio.run(run_demo())
    except KeyboardInterrupt:
        logger.info("Demo interrupted by user")
    except Exception as e:
        logger.error(f"Demo error: {e}")
        import traceback
        traceback.print_exc()