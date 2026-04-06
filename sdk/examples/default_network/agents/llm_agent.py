#!/usr/bin/env python3
"""
LLM Agent - A Python agent with LLM-powered responses.

This agent uses run_agent() to generate intelligent responses using an LLM.

Usage:
    OPENAI_API_KEY=your-key python agents/llm_agent.py

Requires:
    - OPENAI_API_KEY environment variable set
"""

import asyncio
import os
import sys
from pathlib import Path

# Add src to path for development
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "src"))

from openagents.agents.worker_agent import WorkerAgent
from openagents.models.event_context import EventContext
from openagents.models.agent_config import AgentConfig


class LLMAgent(WorkerAgent):
    """An LLM-powered agent that provides helpful responses."""

    default_agent_id = "alex"

    def __init__(self, **kwargs):
        # Create agent config with LLM settings
        agent_config = AgentConfig(
            instruction="""You are Alex, a helpful AI assistant in an OpenAgents network.
            Respond to the user's message in a helpful and friendly way.
            Keep responses concise (1-3 sentences).""",
            model_name=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            provider="openai",
            api_key=os.getenv("OPENAI_API_KEY"),
        )
        super().__init__(agent_config=agent_config, **kwargs)

    async def on_startup(self):
        """Called when agent starts and connects to the network."""
        if not os.getenv("OPENAI_API_KEY"):
            print("Warning: OPENAI_API_KEY not set. LLM responses will not work.")
            print("Set it with: export OPENAI_API_KEY=your-key")
        print("Alex (LLM Agent) is running! Press Ctrl+C to stop.")
        print("Send a message in the 'general' channel to see it respond.")

    async def on_shutdown(self):
        """Called when agent shuts down."""
        print("Alex stopped.")

    async def react(self, context: EventContext):
        """React to incoming messages using LLM."""
        event = context.incoming_event

        # Skip our own messages
        if event.source_id == self.agent_id:
            return

        # Get message content from payload
        content = event.payload.get("content") or event.payload.get("text") or ""
        if not content:
            return

        # Use run_agent to generate LLM response
        try:
            trajectory = await self.run_agent(
                context=context,
                instruction=f"Respond helpfully to: {content}",
            )

            # Extract the response from the trajectory
            response = None
            for action in trajectory.actions:
                if action.payload and action.payload.get("response"):
                    response = action.payload["response"]
                    break

            if not response:
                response = "I'm sorry, I couldn't generate a response."

        except Exception as e:
            print(f"LLM error: {e}")
            response = f"Sorry, I encountered an error: {str(e)[:50]}"

        # Send the response to the channel
        messaging = self.client.mod_adapters.get("openagents.mods.workspace.messaging")
        if messaging:
            channel = event.payload.get("channel") or "general"
            await messaging.send_channel_message(
                channel=channel,
                text=response
            )
            print(f"Responded to {event.source_id}: {response[:50]}...")


async def main():
    """Run the LLM agent."""
    import argparse

    parser = argparse.ArgumentParser(description="LLM Agent")
    parser.add_argument("--host", default="localhost", help="Network host")
    parser.add_argument("--port", type=int, default=8700, help="Network port")
    parser.add_argument("--url", default=None, help="Connection URL (e.g., grpc://localhost:8600 for direct gRPC)")
    args = parser.parse_args()

    agent = LLMAgent()

    try:
        if args.url:
            # Use URL for direct connection (useful for Docker port mapping)
            await agent.async_start(url=args.url)
        else:
            await agent.async_start(
                network_host=args.host,
                network_port=args.port,
            )

        # Keep running until interrupted
        while True:
            await asyncio.sleep(1)

    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        await agent.async_stop()


if __name__ == "__main__":
    asyncio.run(main())
