#!/usr/bin/env python3
"""
Simple Agent - A basic Python agent example.

This agent demonstrates the minimal code needed to connect to an OpenAgents network.
It echoes back any messages it receives.

Usage:
    python agents/simple_agent.py
"""

import asyncio
import sys
from pathlib import Path

# Add src to path for development
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "src"))

from openagents.agents.worker_agent import WorkerAgent
from openagents.models.event_context import EventContext


class SimpleEchoAgent(WorkerAgent):
    """A simple agent that echoes messages back to the channel."""

    default_agent_id = "simple-worker"

    async def on_startup(self):
        """Called when agent starts and connects to the network."""
        print("Simple Worker is running! Press Ctrl+C to stop.")
        print("Send a message in the 'general' channel to see it respond.")

    async def on_shutdown(self):
        """Called when agent shuts down."""
        print("Simple Worker stopped.")

    async def react(self, context: EventContext):
        """React to incoming messages by echoing them back."""
        event = context.incoming_event

        # Skip our own messages
        if event.source_id == self.agent_id:
            return

        # Get message content from payload
        content = event.payload.get("content") or event.payload.get("text") or ""
        if not content:
            return

        # Echo the message back
        response = f"Echo: {content}"

        # Get the messaging adapter and send to channel
        messaging = self.client.mod_adapters.get("openagents.mods.workspace.messaging")
        if messaging:
            channel = event.payload.get("channel") or "general"
            await messaging.send_channel_message(
                channel=channel,
                text=response
            )
            print(f"Responded to {event.source_id}: {response}")


async def main():
    """Run the simple echo agent."""
    import argparse

    parser = argparse.ArgumentParser(description="Simple Echo Agent")
    parser.add_argument("--host", default="localhost", help="Network host")
    parser.add_argument("--port", type=int, default=8700, help="Network port")
    parser.add_argument("--url", default=None, help="Connection URL (e.g., grpc://localhost:8600 for direct gRPC)")
    args = parser.parse_args()

    agent = SimpleEchoAgent()

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
