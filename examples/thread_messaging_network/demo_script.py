#!/usr/bin/env python3
"""
Thread Messaging Network Demo Script

This script demonstrates all features of the Thread Messaging mod:
- Direct messaging between agents
- Channel messaging with mentions
- File upload and sharing
- Reddit-like threading (5 levels)
- Message quoting
- Message retrieval with pagination
- Channel management

Run this script to see a complete workflow of team collaboration
using the Thread Messaging mod.
"""

import asyncio
import logging
import time
import json
from pathlib import Path
from typing import Dict, List, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import OpenAgents modules
import sys
sys.path.append(str(Path(__file__).parent.parent.parent))

from src.openagents.core.client import AgentClient
from src.openagents.mods.communication.thread_messaging import ThreadMessagingAgentAdapter


class DemoAgent:
    """A demo agent that participates in the thread messaging demonstration."""
    
    def __init__(self, agent_id: str, name: str, role: str):
        self.agent_id = agent_id
        self.name = name
        self.role = role
        self.client = None
        self.adapter = None
        self.message_log: List[Dict[str, Any]] = []
        self.received_files: List[str] = []
        
    async def initialize(self, host: str = "localhost", port: int = 8571):
        """Initialize the agent and connect to the network."""
        logger.info(f"Initializing {self.name} ({self.agent_id})")
        
        # Create client
        self.client = AgentClient(agent_id=self.agent_id)
        
        # Create and register thread messaging adapter
        self.adapter = ThreadMessagingAgentAdapter()
        self.client.register_mod_adapter(self.adapter)
        
        # Register message handlers
        self.adapter.register_message_handler("demo_handler", self._handle_message)
        self.adapter.register_file_handler("demo_file_handler", self._handle_file)
        
        # Connect to network with retry logic
        max_retries = 3
        for attempt in range(max_retries):
            try:
                success = await self.client.connect_to_server(host=host, port=port)
                if success:
                    logger.info(f"{self.name} connected to network")
                    break
                else:
                    if attempt < max_retries - 1:
                        logger.warning(f"Connection attempt {attempt + 1} failed for {self.name}, retrying...")
                        await asyncio.sleep(2)
                    else:
                        raise Exception(f"Failed to connect {self.name} to network at {host}:{port} after {max_retries} attempts")
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Connection attempt {attempt + 1} failed for {self.name}: {e}, retrying...")
                    await asyncio.sleep(2)
                else:
                    raise Exception(f"Failed to connect {self.name} to network at {host}:{port} after {max_retries} attempts: {e}")
        
    async def disconnect(self):
        """Disconnect from the network."""
        if self.client:
            await self.client.disconnect()
            logger.info(f"{self.name} disconnected")
    
    def _handle_message(self, content: Dict[str, Any], sender_id: str):
        """Handle incoming messages."""
        action = content.get("action", "unknown")
        
        if action in ["channel_messages_retrieved", "direct_messages_retrieved"]:
            # Handle message retrieval responses
            messages = content.get("messages", [])
            total_count = content.get("total_count", 0)
            logger.info(f"{self.name} retrieved {len(messages)} messages (total: {total_count})")
            
            # Log message details
            for msg in messages[:3]:  # Show first 3 messages
                msg_text = msg.get("content", {}).get("text", "No text")
                msg_sender = msg.get("sender_id", "Unknown")
                logger.info(f"  Message from {msg_sender}: {msg_text[:50]}...")
                
        elif action in ["channel_messages_retrieval_error", "direct_messages_retrieval_error"]:
            error = content.get("error", "Unknown error")
            logger.error(f"{self.name} retrieval error: {error}")
            
        else:
            # Regular message
            text = content.get("text", "")
            if text:
                self.message_log.append({
                    "sender": sender_id,
                    "text": text,
                    "timestamp": time.time(),
                    "action": action
                })
                logger.info(f"{self.name} received from {sender_id}: {text}")
    
    def _handle_file(self, file_id: str, filename: str, file_info: Dict[str, Any]):
        """Handle file operations."""
        action = file_info.get("action", "unknown")
        success = file_info.get("success", False)
        
        if action == "upload" and success:
            logger.info(f"{self.name} uploaded file: {filename} -> {file_id}")
            self.received_files.append(file_id)
        elif action == "download" and success:
            local_path = file_info.get("path", "unknown")
            logger.info(f"{self.name} downloaded file: {filename} -> {local_path}")
        else:
            error = file_info.get("error", "Unknown error")
            logger.error(f"{self.name} file operation failed: {error}")


async def create_demo_file(filename: str, content: str) -> Path:
    """Create a demo file for upload testing."""
    file_path = Path(filename)
    file_path.write_text(content)
    return file_path


async def run_demo():
    """Run the complete thread messaging demonstration."""
    logger.info("🚀 Starting Thread Messaging Network Demo")
    
    # Create demo agents
    agents = {
        "pm": DemoAgent("project_manager", "Project Manager", "manager"),
        "dev": DemoAgent("developer_alice", "Developer Alice", "developer"), 
        "support": DemoAgent("support_bot", "Support Bot", "support"),
        "qa": DemoAgent("qa_tester", "QA Tester", "qa")
    }
    
    try:
        # Initialize all agents
        logger.info("Initializing agents...")
        for agent in agents.values():
            await agent.initialize()
            await asyncio.sleep(1)  # Stagger connections
        
        # Wait for all agents to be ready
        await asyncio.sleep(2)
        
        # ========================================
        # SCENARIO 1: Channel Discovery and Setup
        # ========================================
        logger.info("\n📋 SCENARIO 1: Channel Discovery")
        
        # Project manager lists available channels
        await agents["pm"].adapter.list_channels()
        await asyncio.sleep(1)
        
        # ========================================
        # SCENARIO 2: Team Announcement
        # ========================================
        logger.info("\n📢 SCENARIO 2: Team Announcement")
        
        # PM announces project kickoff
        await agents["pm"].adapter.send_channel_message(
            channel="announcements",
            text="🎉 Kicking off the new OpenAgents v2.0 project! This will be our main communication channel for coordination."
        )
        await asyncio.sleep(1)
        
        # ========================================
        # SCENARIO 3: Development Discussion
        # ========================================
        logger.info("\n💻 SCENARIO 3: Development Discussion")
        
        # Developer starts architecture discussion
        dev_msg_id = None
        await agents["dev"].adapter.send_channel_message(
            channel="development",
            text="I'm working on the new threading system. Should we use a tree structure or linked list for message relationships?"
        )
        await asyncio.sleep(1)
        
        # PM responds with requirements (as new message)
        await agents["pm"].adapter.send_channel_message(
            channel="development",
            text="Great question! We need to support 5 levels of nesting like Reddit. Tree structure would be more efficient for deep threads."
        )
        await asyncio.sleep(1)
        
        # QA provides testing perspective (as new message)
        await agents["qa"].adapter.send_channel_message(
            channel="development",
            text="From a testing perspective, tree structure will be easier to validate. We can test each branch independently."
        )
        await asyncio.sleep(1)
        
        # ========================================
        # SCENARIO 4: Direct Message Coordination
        # ========================================
        logger.info("\n💬 SCENARIO 4: Direct Message Coordination")
        
        # PM sends private message to developer
        await agents["pm"].adapter.send_direct_message(
            target_agent_id="developer_alice",
            text="Alice, can you prepare a technical design document for the threading system? I'd like to review it before the team meeting."
        )
        await asyncio.sleep(1)
        
        # Developer responds
        await agents["dev"].adapter.send_direct_message(
            target_agent_id="project_manager",
            text="Absolutely! I'll have a draft ready by end of day. Should I include performance benchmarks?"
        )
        await asyncio.sleep(1)
        
        # PM follows up with specific requirements
        await agents["pm"].adapter.send_direct_message(
            target_agent_id="developer_alice",
            text="Yes, benchmarks would be great. Focus on memory usage and query performance for deep threads."
        )
        await asyncio.sleep(1)
        
        # ========================================
        # SCENARIO 5: File Sharing
        # ========================================
        logger.info("\n📎 SCENARIO 5: File Sharing")
        
        # Create demo files
        design_doc = await create_demo_file(
            "threading_design.md",
            "# Threading System Design\n\n## Overview\nThis document outlines the architecture for the new Reddit-like threading system...\n\n## Tree Structure\n- Root messages\n- Child replies (up to 5 levels)\n- Thread metadata\n\n## Performance Considerations\n- Memory optimization\n- Query efficiency\n- Scalability"
        )
        
        test_plan = await create_demo_file(
            "test_plan.json",
            json.dumps({
                "test_suite": "Threading System",
                "test_cases": [
                    {"id": 1, "name": "Create thread", "priority": "high"},
                    {"id": 2, "name": "Reply to message", "priority": "high"},
                    {"id": 3, "name": "Deep nesting", "priority": "medium"},
                    {"id": 4, "name": "Quote message", "priority": "medium"}
                ],
                "coverage": "85%"
            }, indent=2)
        )
        
        # Developer uploads design document
        await agents["dev"].adapter.upload_file(str(design_doc))
        await asyncio.sleep(1)
        
        # QA uploads test plan
        await agents["qa"].adapter.upload_file(str(test_plan))
        await asyncio.sleep(1)
        
        # Share file in channel (in real scenario, would use actual file UUID)
        await agents["dev"].adapter.send_channel_message(
            channel="development",
            text="I've uploaded the threading system design document. Please review and provide feedback!"
        )
        await asyncio.sleep(1)
        
        # ========================================
        # SCENARIO 6: Support Ticket Threading
        # ========================================
        logger.info("\n🎫 SCENARIO 6: Support Ticket Threading")
        
        # Support creates ticket
        await agents["support"].adapter.send_channel_message(
            channel="support",
            text="🎫 TICKET #1234: User reports threading not working properly in mobile app. Need dev team assistance.",
            target_agent="developer_alice"  # Mention developer
        )
        await asyncio.sleep(1)
        
        # Developer asks for details
        await agents["dev"].adapter.send_channel_message(
            channel="support",

            text="I can help! Can you provide more details about the specific issue? Which mobile platform?"
        )
        await asyncio.sleep(1)
        
        # Support provides details
        await agents["support"].adapter.send_channel_message(
            channel="support",

            text="iOS app v1.2.3. Users can't see replies beyond 3 levels deep. Android works fine.",

        )
        await asyncio.sleep(1)
        
        # Developer identifies the issue
        await agents["dev"].adapter.send_channel_message(
            channel="support",

            text="Found it! iOS has a different CSS handling for nested elements. I'll push a fix today."
        )
        await asyncio.sleep(1)
        
        # QA offers to test
        await agents["qa"].adapter.send_channel_message(
            channel="support",

            text="I can test the fix on iOS simulator and real devices once it's ready."
        )
        await asyncio.sleep(1)
        
        # ========================================
        # SCENARIO 7: Message History Retrieval
        # ========================================
        logger.info("\n📜 SCENARIO 7: Message History Retrieval")
        
        # PM retrieves development channel history
        await agents["pm"].adapter.retrieve_channel_messages(
            channel="development",
            limit=10,
            include_threads=True
        )
        await asyncio.sleep(2)
        
        # Support retrieves conversation with developer
        await agents["support"].adapter.retrieve_direct_messages(
            target_agent_id="developer_alice",
            limit=5,
            include_threads=True
        )
        await asyncio.sleep(2)
        
        # ========================================
        # SCENARIO 8: Advanced Threading
        # ========================================
        logger.info("\n🧵 SCENARIO 8: Advanced Threading (5 levels)")
        
        # Create a deep thread discussion
        await agents["pm"].adapter.send_channel_message(
            channel="development",
            text="Let's discuss the performance implications of deep threading..."
        )
        await asyncio.sleep(1)
        
        # Level 1 reply
        await agents["dev"].adapter.send_channel_message(
            channel="development",

            text="Memory usage grows linearly with thread depth. Each level adds ~200 bytes overhead."
        )
        await asyncio.sleep(1)
        
        # Level 2 reply
        await agents["qa"].adapter.send_channel_message(
            channel="development", 

            text="What about query performance? Are we indexing thread relationships properly?"
        )
        await asyncio.sleep(1)
        
        # Level 3 reply
        await agents["dev"].adapter.send_channel_message(
            channel="development",
 
            text="Good point! We use adjacency list with materialized path. Query time is O(log n)."
        )
        await asyncio.sleep(1)
        
        # Level 4 reply
        await agents["pm"].adapter.send_channel_message(
            channel="development",
            text="Excellent! That should scale well. What's the practical limit for thread depth?"
        )
        await asyncio.sleep(1)
        
        # Level 5 reply (maximum depth)
        await agents["dev"].adapter.send_channel_message(
            channel="development",

            text="5 levels is our current limit. Beyond that, UX research shows diminishing returns for readability."
        )
        await asyncio.sleep(2)
        
        # ========================================
        # DEMO SUMMARY
        # ========================================
        logger.info("\n📊 DEMO SUMMARY")
        
        # Show message statistics for each agent
        for agent_id, agent in agents.items():
            msg_count = len(agent.message_log)
            file_count = len(agent.received_files)
            logger.info(f"{agent.name}: {msg_count} messages processed, {file_count} files handled")
        
        # Final message retrieval to show complete history
        logger.info("\n📖 Retrieving complete channel history...")
        await agents["pm"].adapter.retrieve_channel_messages(
            channel="development",
            limit=50,
            offset=0,
            include_threads=True
        )
        await asyncio.sleep(2)
        
        logger.info("✅ Thread Messaging Demo completed successfully!")
        
    except Exception as e:
        logger.error(f"❌ Demo failed: {e}")
        raise
        
    finally:
        # Cleanup
        logger.info("🧹 Cleaning up...")
        for agent in agents.values():
            await agent.disconnect()
        
        # Clean up demo files
        for filename in ["threading_design.md", "test_plan.json"]:
            file_path = Path(filename)
            if file_path.exists():
                file_path.unlink()


async def main():
    """Main entry point for the demo."""
    print("🎭 Thread Messaging Network Demo")
    print("=" * 50)
    print("This demo showcases all features of the Thread Messaging mod:")
    print("• Direct messaging between agents")
    print("• Channel messaging with mentions") 
    print("• File upload and sharing")
    print("• Reddit-like threading (5 levels)")
    print("• Message quoting")
    print("• Message retrieval with pagination")
    print("• Channel management")
    print()
    print("Make sure the network is running first:")
    print("  openagents launch-network examples/thread_messaging_network/network_config.yaml")
    print()
    
    input("Press Enter to start the demo...")
    
    try:
        await run_demo()
    except KeyboardInterrupt:
        logger.info("Demo interrupted by user")
    except Exception as e:
        logger.error(f"Demo failed: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
