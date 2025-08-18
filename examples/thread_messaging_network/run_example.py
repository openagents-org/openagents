#!/usr/bin/env python3
"""
Quick start script for Thread Messaging Network example.

This script launches the network and connects multiple agents to demonstrate
the thread messaging capabilities in a more interactive way.
"""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from typing import Dict, List

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import OpenAgents modules
sys.path.append(str(Path(__file__).parent.parent.parent))

from src.openagents.core.client import AgentClient
from src.openagents.mods.communication.thread_messaging import ThreadMessagingAgentAdapter


class InteractiveAgent:
    """An interactive agent for the thread messaging example."""
    
    def __init__(self, agent_id: str, name: str, role: str):
        self.agent_id = agent_id
        self.name = name
        self.role = role
        self.client = None
        self.adapter = None
        self.running = True
        
    async def initialize(self, host: str = "localhost", port: int = 8571):
        """Initialize and connect the agent."""
        logger.info(f"🤖 Initializing {self.name} ({self.agent_id})")
        
        self.client = AgentClient(
            agent_id=self.agent_id,
            host=host,
            port=port
        )
        
        self.adapter = ThreadMessagingAgentAdapter()
        self.client.register_mod_adapter(self.adapter)
        
        # Register handlers
        self.adapter.register_message_handler("main", self._handle_message)
        self.adapter.register_file_handler("main", self._handle_file)
        
        await self.client.connect_to_server()
        logger.info(f"✅ {self.name} connected")
        
    async def disconnect(self):
        """Disconnect the agent."""
        self.running = False
        if self.client:
            await self.client.disconnect()
            logger.info(f"👋 {self.name} disconnected")
    
    def _handle_message(self, content: Dict, sender_id: str):
        """Handle incoming messages."""
        action = content.get("action", "message")
        
        if action == "channel_messages_retrieved":
            messages = content.get("messages", [])
            channel = content.get("channel", "unknown")
            logger.info(f"📨 {self.name} retrieved {len(messages)} messages from #{channel}")
            
        elif action == "direct_messages_retrieved":
            messages = content.get("messages", [])
            target = content.get("target_agent_id", "unknown")
            logger.info(f"💬 {self.name} retrieved {len(messages)} DMs with {target}")
            
        else:
            text = content.get("text", "")
            if text:
                logger.info(f"📩 {self.name} ← {sender_id}: {text}")
    
    def _handle_file(self, file_id: str, filename: str, file_info: Dict):
        """Handle file operations."""
        action = file_info.get("action")
        success = file_info.get("success", False)
        
        if action == "upload" and success:
            logger.info(f"📎 {self.name} uploaded: {filename} → {file_id}")
        elif action == "download" and success:
            logger.info(f"⬇️ {self.name} downloaded: {filename}")


async def demonstrate_basic_features(agents: Dict[str, InteractiveAgent]):
    """Demonstrate basic thread messaging features."""
    pm = agents["pm"]
    dev = agents["dev"]
    support = agents["support"]
    qa = agents["qa"]
    
    logger.info("\n🎯 Demonstrating Thread Messaging Features")
    
    # 1. List channels
    logger.info("1️⃣ Listing available channels...")
    await pm.adapter.list_channels()
    await asyncio.sleep(2)
    
    # 2. Channel messaging
    logger.info("2️⃣ Sending channel messages...")
    await pm.adapter.send_channel_message(
        channel="general",
        text="🚀 Welcome to the Thread Messaging demo! Let's explore the features."
    )
    await asyncio.sleep(1)
    
    await dev.adapter.send_channel_message(
        channel="development",
        text="Working on the new threading system. Looking forward to testing it!",
        target_agent="qa_tester"  # Mention QA
    )
    await asyncio.sleep(1)
    
    # 3. Direct messaging
    logger.info("3️⃣ Sending direct messages...")
    await pm.adapter.send_direct_message(
        target_agent_id="developer_alice",
        text="Can you provide a status update on the threading implementation?"
    )
    await asyncio.sleep(1)
    
    await dev.adapter.reply_direct_message(
        target_agent_id="project_manager",
        reply_to_id="msg_1",
        text="Making great progress! The core threading logic is complete."
    )
    await asyncio.sleep(1)
    
    # 4. File operations (create a sample file)
    logger.info("4️⃣ Uploading files...")
    
    # Create a sample file
    sample_file = Path("examples/thread_messaging_network/sample_report.txt")
    sample_file.write_text(
        "Thread Messaging Status Report\n"
        "==============================\n\n"
        "• Direct messaging: ✅ Complete\n"
        "• Channel messaging: ✅ Complete\n"
        "• File sharing: ✅ Complete\n"
        "• Threading: ✅ Complete\n"
        "• Message retrieval: ✅ Complete\n\n"
        "Next steps:\n"
        "- Performance testing\n"
        "- UI improvements\n"
        "- Documentation updates\n"
    )
    
    await dev.adapter.upload_file(str(sample_file))
    await asyncio.sleep(2)
    
    # 5. Thread creation and replies
    logger.info("5️⃣ Creating threaded conversations...")
    await qa.adapter.send_channel_message(
        channel="development",
        text="Should we test the threading system with edge cases like very long messages?"
    )
    await asyncio.sleep(1)
    
    await dev.adapter.reply_channel_message(
        channel="development",
        reply_to_id="msg_2",
        text="Absolutely! We should test with various message lengths and special characters."
    )
    await asyncio.sleep(1)
    
    await support.adapter.reply_channel_message(
        channel="development",
        reply_to_id="msg_3",
        text="I can help with edge case testing from a user perspective.",
        quote="msg_2"  # Quote the original question
    )
    await asyncio.sleep(1)
    
    # 6. Message retrieval
    logger.info("6️⃣ Retrieving message history...")
    await pm.adapter.retrieve_channel_messages(
        channel="development",
        limit=10,
        include_threads=True
    )
    await asyncio.sleep(2)
    
    await pm.adapter.retrieve_direct_messages(
        target_agent_id="developer_alice",
        limit=5,
        include_threads=True
    )
    await asyncio.sleep(2)
    
    # Cleanup
    if sample_file.exists():
        sample_file.unlink()
    
    logger.info("✅ Basic feature demonstration complete!")


async def interactive_mode(agents: Dict[str, InteractiveAgent]):
    """Run interactive mode where users can send messages."""
    logger.info("\n🎮 Interactive Mode")
    logger.info("Available agents: " + ", ".join(agents.keys()))
    logger.info("Commands:")
    logger.info("  send <agent> <channel> <message>     - Send channel message")
    logger.info("  dm <from_agent> <to_agent> <message> - Send direct message")
    logger.info("  reply <agent> <channel> <msg_id> <message> - Reply to message")
    logger.info("  retrieve <agent> <channel>           - Retrieve channel messages")
    logger.info("  list <agent>                         - List channels")
    logger.info("  quit                                 - Exit interactive mode")
    print()
    
    while True:
        try:
            command = input("💭 Enter command: ").strip()
            
            if command == "quit":
                break
                
            parts = command.split(" ", 4)
            if len(parts) < 2:
                print("❌ Invalid command")
                continue
                
            cmd_type = parts[0]
            
            if cmd_type == "send" and len(parts) >= 4:
                agent_id, channel, message = parts[1], parts[2], " ".join(parts[3:])
                if agent_id in agents:
                    await agents[agent_id].adapter.send_channel_message(channel, message)
                    print(f"✅ Sent to #{channel}")
                else:
                    print(f"❌ Unknown agent: {agent_id}")
                    
            elif cmd_type == "dm" and len(parts) >= 4:
                from_agent, to_agent, message = parts[1], parts[2], " ".join(parts[3:])
                if from_agent in agents:
                    await agents[from_agent].adapter.send_direct_message(to_agent, message)
                    print(f"✅ DM sent to {to_agent}")
                else:
                    print(f"❌ Unknown agent: {from_agent}")
                    
            elif cmd_type == "list" and len(parts) >= 2:
                agent_id = parts[1]
                if agent_id in agents:
                    await agents[agent_id].adapter.list_channels()
                    print("✅ Channel list requested")
                else:
                    print(f"❌ Unknown agent: {agent_id}")
                    
            elif cmd_type == "retrieve" and len(parts) >= 3:
                agent_id, channel = parts[1], parts[2]
                if agent_id in agents:
                    await agents[agent_id].adapter.retrieve_channel_messages(channel, limit=10)
                    print(f"✅ Retrieved messages from #{channel}")
                else:
                    print(f"❌ Unknown agent: {agent_id}")
                    
            else:
                print("❌ Invalid command format")
                
            await asyncio.sleep(0.5)
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"❌ Error: {e}")


async def main():
    """Main entry point."""
    print("🌐 Thread Messaging Network - Interactive Example")
    print("=" * 55)
    
    # Create agents
    agents = {
        "pm": InteractiveAgent("project_manager", "Project Manager", "manager"),
        "dev": InteractiveAgent("developer_alice", "Developer Alice", "developer"),
        "support": InteractiveAgent("support_bot", "Support Bot", "support"),
        "qa": InteractiveAgent("qa_tester", "QA Tester", "qa")
    }
    
    # Setup signal handlers
    def signal_handler(signum, frame):
        logger.info("🛑 Received shutdown signal")
        for agent in agents.values():
            asyncio.create_task(agent.disconnect())
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Initialize agents
        logger.info("🔧 Initializing agents...")
        for agent in agents.values():
            await agent.initialize()
            await asyncio.sleep(0.5)
        
        logger.info(f"✅ All {len(agents)} agents connected")
        await asyncio.sleep(1)
        
        # Run feature demonstration
        await demonstrate_basic_features(agents)
        
        # Ask if user wants interactive mode
        choice = input("\n🎮 Enter interactive mode? (y/N): ").strip().lower()
        if choice in ['y', 'yes']:
            await interactive_mode(agents)
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return 1
        
    finally:
        logger.info("🧹 Cleaning up...")
        for agent in agents.values():
            await agent.disconnect()
        logger.info("👋 Goodbye!")
    
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
