#!/usr/bin/env python3
"""
Example demonstrating WorkerAgent with EventResponse integration.

This example shows how to use the refactored WorkerAgent that returns
EventResponse objects for all messaging operations, enabling proper
error handling and response validation.
"""

import asyncio
import logging
from openagents.agents.worker_agent import WorkerAgent
from openagents.models.event_response import EventResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EventResponseExampleAgent(WorkerAgent):
    """Example agent demonstrating EventResponse usage."""
    
    default_agent_id = "eventresponse-demo"
    
    async def on_direct(self, msg):
        """Handle direct messages with proper EventResponse handling."""
        logger.info(f"Received direct message from {msg.source_id}: {msg.text}")
        
        # Send a response and check the EventResponse
        response = await self.send_direct(
            to=msg.source_id, 
            text=f"Thanks for your message: '{msg.text}'. I received it successfully!"
        )
        
        if response.success:
            logger.info(f"✅ Successfully sent response: {response.message}")
        else:
            logger.error(f"❌ Failed to send response: {response.message}")
    
    async def on_channel_mention(self, msg):
        """Handle channel mentions with EventResponse error handling."""
        logger.info(f"Mentioned in #{msg.channel} by {msg.source_id}: {msg.text}")
        
        # Post a response to the channel
        response = await self.post_to_channel(
            channel=msg.channel,
            text=f"Hello @{msg.source_id}! I saw your mention. How can I help?"
        )
        
        if response.success:
            logger.info(f"✅ Posted response to #{msg.channel}")
            
            # Try to react to the original message
            reaction_response = await self.react_to_message(
                channel=msg.channel,
                message_id=msg.message_id,
                reaction="👍"
            )
            
            if reaction_response.success:
                logger.info("✅ Added reaction to message")
            else:
                logger.warning(f"⚠️ Could not add reaction: {reaction_response.message}")
        else:
            logger.error(f"❌ Failed to post to #{msg.channel}: {response.message}")
    
    async def on_channel_post(self, msg):
        """Handle channel posts with message history retrieval."""
        logger.info(f"New post in #{msg.channel} by {msg.source_id}: {msg.text}")
        
        # Example: Get recent messages if someone asks for history
        if "history" in msg.text.lower() or "recent messages" in msg.text.lower():
            logger.info("Getting recent channel messages...")
            
            try:
                messages = await self.get_channel_messages(msg.channel, limit=5)
                count = len(messages.get("messages", []))
                
                response = await self.post_to_channel(
                    channel=msg.channel,
                    text=f"I found {count} recent messages in this channel."
                )
                
                if response.success:
                    logger.info("✅ Posted message count")
                else:
                    logger.error(f"❌ Failed to post message count: {response.message}")
                    
            except Exception as e:
                logger.error(f"Error getting channel messages: {e}")
                
                error_response = await self.post_to_channel(
                    channel=msg.channel,
                    text="Sorry, I couldn't retrieve the message history right now."
                )
                
                if not error_response.success:
                    logger.error(f"Even error message failed: {error_response.message}")
    
    async def on_startup(self):
        """Called when agent starts up."""
        logger.info(f"🚀 {self.default_agent_id} started with EventResponse integration!")
        
        # Test getting channel list
        try:
            channels = await self.get_channel_list()
            logger.info(f"📋 Available channels: {channels}")
        except Exception as e:
            logger.warning(f"Could not get channel list: {e}")
        
        # Test getting agent list  
        try:
            agents = await self.get_agent_list()
            logger.info(f"🤖 Connected agents: {agents}")
        except Exception as e:
            logger.warning(f"Could not get agent list: {e}")


def main():
    """Main function to demonstrate the EventResponse agent."""
    print("EventResponse WorkerAgent Example")
    print("=" * 40)
    print()
    print("This example demonstrates:")
    print("• EventResponse return values from messaging methods")
    print("• Proper error handling with success/failure checks")
    print("• Integration with workspace functionality")
    print("• Message history retrieval")
    print()
    print("To test:")
    print("1. Start a network with thread messaging")
    print("2. Run this agent")
    print("3. Send direct messages or mention the agent in channels")
    print("4. Say 'history' in a channel to test message retrieval")
    print()
    
    # Create and configure the agent
    agent = EventResponseExampleAgent()
    
    print(f"Agent ID: {agent.default_agent_id}")
    print("Agent created successfully with EventResponse integration!")
    print()
    print("Available methods returning EventResponse:")
    methods = ['send_direct', 'post_to_channel', 'reply_to_message', 'react_to_message']
    for method in methods:
        if hasattr(agent, method):
            print(f"• {method}() -> EventResponse")
    
    print()
    print("Available utility methods:")
    utils = ['get_channel_messages', 'get_direct_messages', 'get_channel_list', 'get_agent_list']
    for method in utils:
        if hasattr(agent, method):
            print(f"• {method}()")
    
    print()
    print("To run the agent, use:")
    print("openagents launch-agent <config-file>")
    print("or use the AgentRunner directly in your application.")


if __name__ == "__main__":
    main()