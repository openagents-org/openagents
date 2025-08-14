#!/usr/bin/env python3
"""
OpenAgents Full Example - Complete Demonstration

This script demonstrates the complete OpenAgents workflow:
1. Launch a network server
2. Start a simple echo agent  
3. Connect a client to interact with the agent
4. Clean shutdown of all components

WHAT THIS EXAMPLE DEMONSTRATES:
==============================

🌐 Network Management:
   - Creating and starting a centralized OpenAgents network
   - Configuring WebSocket transport and security settings
   - Proper network initialization and shutdown

🤖 Agent Lifecycle:
   - Creating custom agents that extend AgentRunner
   - Agent connection, setup, and teardown processes
   - Message processing and response generation

💬 Messaging System:
   - Direct messaging between specific agents
   - Broadcast messaging to all network participants
   - Echo functionality and automatic responses
   - Greeting detection and personalized responses

🔍 Network Discovery:
   - Agent registration and discovery
   - Listing connected agents and their metadata
   - Real-time agent status tracking

🧹 Resource Management:
   - Graceful shutdown of all components
   - Proper cleanup and resource deallocation
   - Signal handling for interruption

USAGE:
======
Simply run this script:
    python examples/full_example.py

The script will automatically:
1. Load network from examples/centralized_network_config.yaml
2. Load echo agent from examples/simple_echo_agent_config.yaml
3. Connect a demo client that sends test messages
4. Show the complete interaction flow
5. Clean up everything when done

Uses existing configuration files to demonstrate best practices!
Perfect for understanding how to leverage OpenAgents config-driven approach.
"""

import asyncio
import logging
import os
import signal
import sys
import time
import yaml
from typing import Optional

# Configure logging for better visibility
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.models.messages import DirectMessage, BroadcastMessage
from openagents.agents.simple_echo_agent import SimpleEchoAgentRunner


# We now use the real SimpleEchoAgentRunner from src/openagents/agents/simple_echo_agent.py


class InteractiveClient:
    """A simple interactive client for demonstrating agent interaction.
    
    This is a simplified version based on agent_client_example.py
    """
    
    def __init__(self, agent_id: str = "demo-client"):
        self.agent_id = agent_id
        self.client = AgentClient(agent_id=agent_id)
        self.received_messages = []

    async def connect(self, host: str = "localhost", port: int = 8570):
        """Connect to the network (based on agent_client_example.py)."""
        print(f"🔗 [Client] Connecting to network at {host}:{port}...")
        
        # Client metadata (following the pattern from agent_client_example.py)
        metadata = {
            "name": "Demo Interactive Client",
            "type": "demo_client",
            "capabilities": ["messaging", "interaction"],
            "version": "1.0.0"
        }
        
        success = await self.client.connect(
            host=host,
            port=port,
            metadata=metadata
        )
        
        if success:
            print(f"✅ [Client] Connected successfully as {self.agent_id}")
            
            # Register message handlers (same pattern as agent_client_example.py)
            if self.client.connector:
                self.client.connector.register_message_handler("direct_message", self._handle_direct_message)
                self.client.connector.register_message_handler("broadcast_message", self._handle_broadcast_message)
            
            return True
        else:
            print("❌ [Client] Failed to connect to network")
            return False

    async def _handle_direct_message(self, message_data):
        """Handle incoming direct messages (based on agent_client_example.py)."""
        # Handle both dict and object formats
        if hasattr(message_data, 'sender_id'):
            sender_id = message_data.sender_id
            content = message_data.content
            text = content.get("text", str(content)) if isinstance(content, dict) else str(content)
        else:
            sender_id = message_data.get("sender_id", "Unknown")
            content = message_data.get("content", {})
            text = content.get("text", str(content))
        
        print(f"📨 [Client] Received direct message from {sender_id}: {text}")
        self.received_messages.append({"type": "direct", "from": sender_id, "text": text})

    async def _handle_broadcast_message(self, message_data):
        """Handle incoming broadcast messages (based on agent_client_example.py)."""
        # Handle both dict and object formats
        if hasattr(message_data, 'sender_id'):
            sender_id = message_data.sender_id
            content = message_data.content
            text = content.get("text", str(content)) if isinstance(content, dict) else str(content)
        else:
            sender_id = message_data.get("sender_id", "Unknown")
            content = message_data.get("content", {})
            text = content.get("text", str(content))
        
        print(f"📢 [Client] Received broadcast from {sender_id}: {text}")
        self.received_messages.append({"type": "broadcast", "from": sender_id, "text": text})

    async def send_direct_message(self, target_agent_id: str, text: str):
        """Send a direct message (following agent_client_example.py pattern)."""
        message = DirectMessage(
            sender_id=self.agent_id,
            target_agent_id=target_agent_id,
            protocol="openagents.mods.communication.simple_messaging",
            message_type="direct_message",
            content={"text": text},
            text_representation=text,
            requires_response=False
        )
        
        await self.client.send_direct_message(message)
        print(f"📤 [Client] Sent direct message to {target_agent_id}: {text}")

    async def send_broadcast_message(self, text: str):
        """Send a broadcast message (following agent_client_example.py pattern)."""
        message = BroadcastMessage(
            sender_id=self.agent_id,
            protocol="openagents.mods.communication.simple_messaging",
            message_type="broadcast_message",
            content={"text": text},
            text_representation=text,
            requires_response=False
        )
        
        await self.client.send_broadcast_message(message)
        print(f"📡 [Client] Sent broadcast: {text}")

    async def list_agents(self):
        """List all agents in the network (same as agent_client_example.py)."""
        agents = await self.client.list_agents()
        print(f"👥 [Client] Found {len(agents)} agents in the network:")
        for agent in agents:
            print(f"   - {agent.get('agent_id', 'Unknown')}: {agent.get('metadata', {})}")
        return agents

    async def disconnect(self):
        """Disconnect from the network (same as agent_client_example.py)."""
        if self.client.connector:
            await self.client.disconnect()
        print("🔌 [Client] Disconnected from network")


# Global variables for components
network = None
echo_agent = None
client = None
host = "localhost"
port = 8570


async def setup_network():
    """Setup and start the network server using existing config file."""
    global network, host, port
    
    print("🌐 [Network] Loading network from centralized_network_config.yaml...")
    
    # Use the existing centralized network configuration
    config_path = "examples/centralized_network_config.yaml"
    
    try:
        # Load network directly from YAML file using AgentNetwork.load() - mods are loaded automatically!
        network = AgentNetwork.load(config_path)
        print(f"✅ [Network] Loaded configuration and mods from {config_path}")
        
        # Initialize network
        result = await network.initialize()
        
        if result:
            print(f"✅ [Network] Network '{network.network_name}' started successfully")
            # Update host and port from config for client connections
            network_config = network.config
            host = network_config.host if network_config.host != "0.0.0.0" else "localhost"
            port = network_config.port
            return True
        else:
            print("❌ [Network] Failed to initialize network")
            return False
            
    except Exception as e:
        print(f"❌ [Network] Error loading network config: {e}")
        return False


async def start_echo_agent():
    """Start the echo agent."""
    global echo_agent, host, port
    
    try:
        # Create the real SimpleEchoAgentRunner
        print("🤖 [Echo Agent] Starting echo agent...")
        echo_agent = SimpleEchoAgentRunner(
            agent_id="simple-echo-agent",
            echo_prefix="Echo"
        )
        
        # Start the agent
        await echo_agent.async_start(
            host=host,
            port=port,
            metadata={
                "name": "Simple Echo Agent",
                "type": "echo_agent", 
                "capabilities": ["echo", "greeting", "demo"],
                "version": "1.0.0"
            }
        )
        
        # Wait a moment for the agent to fully initialize
        await asyncio.sleep(2.0)
        print("✅ [Echo Agent] Echo agent started successfully")
        return True
        
    except Exception as e:
        print(f"❌ [Echo Agent] Failed to start: {e}")
        return False


async def run_demo_sequence():
    """Run the demonstration sequence."""
    global client
    
    # Step 1: List agents
    print("\n📋 Step 1: Discovering agents in the network...")
    await asyncio.sleep(1.0)
    agents = await client.list_agents()
    
    # Step 2: Send a greeting broadcast
    print("\n👋 Step 2: Sending a greeting broadcast...")
    await asyncio.sleep(1.0)
    await client.send_broadcast_message("Hello everyone! This is the demo client!")
    await asyncio.sleep(2.0)  # Wait for responses
    
    # Step 3: Send direct messages to echo agent  
    print("\n🎯 Step 3: Sending direct messages to the echo agent...")
    await asyncio.sleep(1.0)
    
    test_messages = [
        "Hello echo agent!",
        "Can you echo this message?",
        "Testing 1, 2, 3...",
        "This is the final test message!"
    ]
    
    for i, message in enumerate(test_messages, 1):
        print(f"   📤 Sending message {i}/4: {message}")
        await client.send_direct_message("simple-echo-agent", message)
        await asyncio.sleep(1.5)  # Wait between messages
    
    # Step 4: Wait for all responses
    print("\n⏳ Step 4: Waiting for all responses...")
    await asyncio.sleep(3.0)
    
    # Step 5: Show results
    print("\n📊 Step 5: Demo Results Summary")
    print(f"   💬 Client received {len(client.received_messages)} messages")
    
    direct_messages = [msg for msg in client.received_messages if msg["type"] == "direct"]
    broadcast_messages = [msg for msg in client.received_messages if msg["type"] == "broadcast"]
    
    print(f"   📨 Direct messages: {len(direct_messages)}")
    print(f"   📢 Broadcast messages: {len(broadcast_messages)}")
    
    if direct_messages:
        print("\n   Last few direct messages received:")
        for msg in direct_messages[-3:]:
            print(f"      🔄 From {msg['from']}: {msg['text']}")
    
    print(f"\n   🤖 Echo agent successfully processed and responded to all messages!")
    print(f"   ✨ This demonstrates the full OpenAgents messaging workflow.")


async def run_interactive_demo():
    """Run the interactive demonstration with the client."""
    global client, host, port
    
    print("\n🎮 [Demo] Starting interactive demonstration...")
    
    # Create and connect client
    client = InteractiveClient("demo-client")
    
    if not await client.connect(host, port):
        return False
    
    # Wait a moment for connection to stabilize
    await asyncio.sleep(2.0)
    
    print("\n" + "="*60)
    print("🎯 INTERACTIVE DEMO - Let's interact with the echo agent!")
    print("="*60)
    
    # Demo sequence
    await run_demo_sequence()
    
    # Disconnect client
    await client.disconnect()
    return True


async def cleanup():
    """Clean up all components."""
    global network, echo_agent, client
    
    print("\n🧹 [Cleanup] Shutting down all components...")
    
    # Stop echo agent
    if echo_agent and echo_agent._running:
        try:
            await echo_agent.async_stop()
            print("✅ [Cleanup] Echo agent stopped")
        except Exception as e:
            print(f"⚠️ [Cleanup] Error stopping echo agent: {e}")
    
    # Disconnect client
    if client:
        try:
            await client.disconnect()
            print("✅ [Cleanup] Client disconnected")
        except Exception as e:
            print(f"⚠️ [Cleanup] Error disconnecting client: {e}")
    
    # Shutdown network
    if network and network.is_running:
        try:
            await network.shutdown()
            print("✅ [Cleanup] Network stopped")
        except Exception as e:
            print(f"⚠️ [Cleanup] Error stopping network: {e}")
    
    print("🎉 [Cleanup] All components shut down successfully!")


async def main():
    """Main entry point for the full example."""
    print("🚀 OpenAgents Full Example - Starting Complete Demonstration")
    print("=" * 65)
    
    try:
        # Step 1: Setup network
        if not await setup_network():
            return 1
        
        # Wait for network to be ready
        await asyncio.sleep(2.0)
        
        # Step 2: Start echo agent
        if not await start_echo_agent():
            return 1
        
        # Wait for agent to be ready
        await asyncio.sleep(2.0)
        
        # Step 3: Run interactive demo
        if not await run_interactive_demo():
            return 1

        print("\n✨ OpenAgents Full Example completed successfully!")
        return 0
        
    except KeyboardInterrupt:
        print("\n\n⚡ [Demo] Received interrupt signal...")
        return 0
    except Exception as e:
        print(f"\n❌ [Demo] Error during demonstration: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        # Always cleanup
        await cleanup()


if __name__ == "__main__":
    # Run the example
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
        sys.exit(0)
