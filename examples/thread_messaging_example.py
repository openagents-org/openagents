#!/usr/bin/env python3
"""
Example demonstrating the Thread Messaging mod for OpenAgents.

This example shows how to use Discord/Slack-like threading features including:
- Replying to messages to create threads
- Quoting messages for context
- Adding reactions to messages
- Sending files in threaded conversations
"""

import asyncio
import logging
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.mods.communication.thread_messaging import ThreadMessagingAgentAdapter

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ThreadMessagingExampleAgent:
    """Example agent demonstrating thread messaging capabilities."""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.client = AgentClient(agent_id=agent_id)
        self.thread_adapter = ThreadMessagingAgentAdapter()
        
        # Register the mod adapter
        self.client.register_mod_adapter(self.thread_adapter)
        
        # Register handlers
        self._setup_handlers()
        
        # Track messages for demo purposes
        self.received_messages = []
        self.received_reactions = []
    
    def _setup_handlers(self):
        """Set up message and reaction handlers."""
        
        def message_handler(content, sender_id):
            """Handle incoming messages."""
            message_info = {
                'sender': sender_id,
                'text': content.get('text', ''),
                'reply_to': content.get('reply_to_id'),
                'quoted': content.get('quoted_text'),
                'files': content.get('files', [])
            }
            self.received_messages.append(message_info)
            
            logger.info(f"[{self.agent_id}] Received message from {sender_id}: {content.get('text', '')}")
            
            if content.get('reply_to_id'):
                logger.info(f"[{self.agent_id}] This is a reply to: {content['reply_to_id']}")
            
            if content.get('quoted_text'):
                logger.info(f"[{self.agent_id}] Quoted: '{content['quoted_text']}'")
            
            if content.get('files'):
                logger.info(f"[{self.agent_id}] Has {len(content['files'])} file(s)")
        
        def reaction_handler(message_id, agent_id, reaction_type, action):
            """Handle incoming reactions."""
            reaction_info = {
                'message_id': message_id,
                'from_agent': agent_id,
                'reaction': reaction_type,
                'action': action
            }
            self.received_reactions.append(reaction_info)
            
            logger.info(f"[{self.agent_id}] {agent_id} reacted with {reaction_type} to message {message_id}")
        
        def file_handler(file_id, file_content, metadata, sender_id):
            """Handle incoming files."""
            logger.info(f"[{self.agent_id}] Received file {file_id} from {sender_id} ({len(file_content)} bytes)")
        
        # Register handlers
        self.thread_adapter.register_message_handler("main", message_handler)
        self.thread_adapter.register_reaction_handler("main", reaction_handler)
        self.thread_adapter.register_file_handler("main", file_handler)
    
    async def connect(self, host="localhost", port=8000):
        """Connect to the network."""
        success = await self.client.connect_to_server(host=host, port=port)
        if success:
            logger.info(f"[{self.agent_id}] Connected to network")
        return success
    
    async def disconnect(self):
        """Disconnect from the network."""
        await self.client.disconnect()
        logger.info(f"[{self.agent_id}] Disconnected from network")


async def demonstrate_threading():
    """Demonstrate thread messaging features."""
    
    # Create two agents
    alice = ThreadMessagingExampleAgent("Alice")
    bob = ThreadMessagingExampleAgent("Bob")
    
    try:
        # Connect both agents (assuming network is running)
        logger.info("Connecting agents to network...")
        await alice.connect()
        await bob.connect()
        
        # Give time for connections to establish
        await asyncio.sleep(1)
        
        # Scenario 1: Basic threading
        logger.info("\n=== Scenario 1: Basic Threading ===")
        
        # Alice sends an initial message
        await alice.thread_adapter.send_thread_message(
            target_agent_id="Bob",
            content={"text": "Hey Bob, what do you think about implementing a new feature?"}
        )
        await asyncio.sleep(0.5)
        
        # Bob replies, creating a thread
        if alice.received_messages:
            original_message_id = alice.received_messages[-1].get('message_id', 'msg_1')
            await bob.thread_adapter.reply_to_message(
                target_agent_id="Alice",
                text="Great idea! What kind of feature are you thinking?",
                reply_to_id=original_message_id
            )
        await asyncio.sleep(0.5)
        
        # Alice replies back in the thread
        if bob.received_messages:
            await alice.thread_adapter.reply_to_message(
                target_agent_id="Bob", 
                text="I was thinking about a chat threading system, like Slack!",
                reply_to_id=original_message_id
            )
        await asyncio.sleep(0.5)
        
        # Scenario 2: Reactions
        logger.info("\n=== Scenario 2: Message Reactions ===")
        
        # Bob reacts to Alice's idea
        if alice.received_messages:
            message_to_react = alice.received_messages[0].get('message_id', 'msg_1')
            await bob.thread_adapter.react_to_message(
                message_id=message_to_react,
                reaction_type="like",
                target_agent_id="Alice"
            )
        await asyncio.sleep(0.5)
        
        # Alice adds a +1 reaction
        if bob.received_messages:
            message_to_react = bob.received_messages[0].get('message_id', 'msg_2')
            await alice.thread_adapter.react_to_message(
                message_id=message_to_react,
                reaction_type="+1",
                target_agent_id="Bob"
            )
        await asyncio.sleep(0.5)
        
        # Scenario 3: Broadcast with threading
        logger.info("\n=== Scenario 3: Broadcast Threading ===")
        
        # Alice broadcasts a question
        await alice.thread_adapter.send_broadcast_thread_message(
            content={"text": "Who wants to help with the documentation?"}
        )
        await asyncio.sleep(0.5)
        
        # Bob replies to the broadcast
        if alice.received_messages:
            broadcast_id = alice.received_messages[-1].get('message_id', 'broadcast_1')
            await bob.thread_adapter.reply_to_broadcast_message(
                text="I can help with the API documentation!",
                reply_to_id=broadcast_id
            )
        await asyncio.sleep(0.5)
        
        # Scenario 4: Message quoting
        logger.info("\n=== Scenario 4: Message Quoting ===")
        
        # Alice quotes Bob's earlier message in a new conversation
        if bob.received_messages:
            message_to_quote = bob.received_messages[0] 
            await alice.thread_adapter.quote_message(
                target_agent_id="Bob",
                text="I was thinking more about your suggestion...",
                quoted_message_id=message_to_quote.get('message_id', 'msg_2'),
                quoted_text="Great idea! What kind of feature are you thinking?"
            )
        await asyncio.sleep(0.5)
        
        # Scenario 5: Channel operations
        logger.info("\n=== Scenario 5: Channel Operations ===")
        
        # List available channels
        await alice.thread_adapter.list_channels()
        await asyncio.sleep(0.5)
        
        # Send messages in different channels (assuming a "dev" channel exists)
        await alice.thread_adapter.send_broadcast_thread_message(
            content={"text": "Development team discussion in dev channel"},
            channel="dev"
        )
        await asyncio.sleep(0.5)
        
        # Reply in the dev channel
        if alice.received_messages:
            dev_message_id = alice.received_messages[-1].get('message_id', 'dev_msg_1')
            await bob.thread_adapter.reply_to_broadcast_message(
                text="Working on the new feature branch",
                reply_to_id=dev_message_id,
                channel="dev"
            )
        await asyncio.sleep(0.5)
        
        # Scenario 6: File sharing in threads (if files exist)
        logger.info("\n=== Scenario 6: File Sharing in Threads ===")
        
        # Create a temporary file for demo
        demo_file = Path("demo_file.txt")
        demo_file.write_text("This is a demo file for thread messaging!")
        
        try:
            # Alice sends a file as part of a thread in the general channel
            if alice.received_messages:
                await alice.thread_adapter.send_thread_file(
                    target_agent_id="Bob",
                    file_path=str(demo_file),
                    message_text="Here's the spec document we discussed",
                    reply_to_id=alice.received_messages[0].get('message_id', 'msg_1')
                )
        except Exception as e:
            logger.info(f"File demo skipped: {e}")
        finally:
            # Clean up demo file
            if demo_file.exists():
                demo_file.unlink()
        
        await asyncio.sleep(1)
        
        # Print summary
        logger.info("\n=== Demo Summary ===")
        logger.info(f"Alice received {len(alice.received_messages)} messages and {len(alice.received_reactions)} reactions")
        logger.info(f"Bob received {len(bob.received_messages)} messages and {len(bob.received_reactions)} reactions")
        
        # Show message details
        for i, msg in enumerate(alice.received_messages):
            logger.info(f"Alice Message {i+1}: {msg}")
        
        for i, msg in enumerate(bob.received_messages):
            logger.info(f"Bob Message {i+1}: {msg}")
    
    except Exception as e:
        logger.error(f"Demo failed: {e}")
        logger.info("Make sure the OpenAgents network server is running!")
        logger.info("You can start a network with: python -m openagents.launchers.network_launcher")
    
    finally:
        # Disconnect agents
        await alice.disconnect()
        await bob.disconnect()


async def demonstrate_reactions_only():
    """Demonstrate just the reaction features without network."""
    logger.info("\n=== Reaction Types Demo ===")
    
    from openagents.mods.communication.thread_messaging import REACTION_TYPES
    
    logger.info("Available reaction types:")
    for reaction in REACTION_TYPES:
        logger.info(f"  - {reaction}")
    
    logger.info("\nExample usage:")
    logger.info("await adapter.react_to_message(message_id='abc123', reaction_type='like')")
    logger.info("await adapter.react_to_message(message_id='def456', reaction_type='+1')")
    logger.info("await adapter.react_to_message(message_id='ghi789', reaction_type='done')")


if __name__ == "__main__":
    print("Thread Messaging Mod Example")
    print("=" * 40)
    
    # Run the demonstrations
    asyncio.run(demonstrate_reactions_only())
    
    # Try the full networking demo
    print("\nAttempting full network demo...")
    print("(This requires a running OpenAgents network)")
    asyncio.run(demonstrate_threading())
