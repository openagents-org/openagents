import asyncio
import logging
from typing import Dict, List, Optional

from openagents.agents.runner import AgentRunner
from openagents.models.event_thread import EventThread
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event
from openagents.models.event_context import EventContext

logger = logging.getLogger(__name__)


class SimpleEchoAgentRunner(AgentRunner):
    """A simple echo agent that echoes back direct messages without requiring any AI model.

    This agent demonstrates how to create a basic agent that responds to messages
    without needing external AI services or API keys.
    """

    def __init__(
        self,
        agent_id: str,
        protocol_names: Optional[List[str]] = None,
        ignored_sender_ids: Optional[List[str]] = None,
        echo_prefix: Optional[str] = "Echo",
    ):
        """Initialize the SimpleEchoAgentRunner.

        Args:
            agent_id: Unique identifier for this agent
            protocol_names: List of protocol names to register with
            ignored_sender_ids: List of sender IDs to ignore messages from
            echo_prefix: Prefix to add to echoed messages (default: "Echo")
        """
        super().__init__(agent_id=agent_id, ignored_sender_ids=ignored_sender_ids)
        self.echo_prefix = echo_prefix or "Echo"
        self.message_count = 0

    async def react(self, context: EventContext):
        """React to incoming messages by echoing them back.

        Args:
            context: The event context containing incoming event, threads, and thread ID
        """
        incoming_message = context.incoming_event
        print(
            f"🎯 ECHO AGENT: react method called with message from {incoming_message.source_id}"
        )
        print(f"   Message type: {type(incoming_message).__name__}")
        print(f"   Content: {incoming_message.payload}")
        logger.info(f"🎯 Echo agent received message from {incoming_message.source_id}")
        logger.info(f"   Message type: {type(incoming_message).__name__}")
        logger.info(f"   Content: {incoming_message.payload}")

        self.message_count += 1
        sender_id = incoming_message.source_id
        content = incoming_message.payload

        # Extract text from content
        if isinstance(content, dict):
            text = content.get("text", str(content))
        else:
            text = str(content)

        # Handle different message types based on event name
        if "direct_message" in incoming_message.event_name:
            logger.info(f"Processing direct message from {sender_id}")

            # Create echo response
            echo_text = f"{self.echo_prefix}: {text}"
            echo_message = Event(
                event_name="agent.message",
                source_id=self.client.agent_id,
                destination_id=sender_id,
                payload={
                    "text": echo_text,
                    "protocol": "openagents.mods.communication.simple_messaging",
                    "message_type": "direct_message",
                },
                text_representation=echo_text,
                requires_response=False,
            )

            # Send the echo message back
            logger.info(f"🔧 ECHO: About to call self.client.send_direct_message")
            logger.info(f"🔧 ECHO: Client type: {type(self.client)}")
            logger.info(
                f"🔧 ECHO: Client hasattr send_direct_message: {hasattr(self.client, 'send_direct_message')}"
            )
            result = await self.client.send_direct_message(echo_message)
            logger.info(
                f"✅ Sent echo message back to {sender_id}: {echo_text} - success: {result}"
            )
            if not result:
                logger.error(f"❌ Failed to send echo message to {sender_id}")

        elif "broadcast_message" in incoming_message.event_name:
            logger.info(f"Processing broadcast message from {sender_id}")

            # Respond to greetings in broadcast messages
            if "hello" in text.lower() and sender_id != self.client.agent_id:
                greeting_text = f"Hello {sender_id}! I'm an echo agent. Send me a direct message and I'll echo it back!"
                greeting_message = Event(
                    event_name="agent.message",
                    source_id=self.client.agent_id,
                    destination_id=sender_id,
                    payload={
                        "text": greeting_text,
                        "protocol": "openagents.mods.communication.simple_messaging",
                        "message_type": "direct_message",
                    },
                    text_representation=greeting_text,
                    requires_response=False,
                )
                await self.client.send_direct_message(greeting_message)
                logger.info(f"✅ Sent greeting message to {sender_id}")
        else:
            logger.info(f"Received unknown message type: {incoming_message.event_name}")

    async def setup(self):
        """Setup the agent after connection.

        This method is called after the agent successfully connects to the network.
        """
        logger.info(f"🚀 Echo agent {self.client.agent_id} is ready!")
        print(f"🚀 Echo agent {self.client.agent_id} is ready!")

        # Announce presence to the network
        announcement_text = f"Echo agent {self.client.agent_id} is online! Send me a direct message and I'll echo it back."
        greeting = Event(
            event_name="agent.broadcast_message.sent",
            source_id=self.client.agent_id,
            payload={
                "text": announcement_text,
                "relevant_mod": "openagents.mods.communication.simple_messaging",
                "message_type": "broadcast_message",
            },
            text_representation=announcement_text,
            requires_response=False,
        )
        await self.client.send_broadcast_message(greeting)
        logger.info("📢 Announced presence to the network")

    async def teardown(self):
        """Cleanup before agent disconnection.

        This method is called before the agent disconnects from the network.
        """
        logger.info(f"👋 Echo agent {self.client.agent_id} is shutting down...")

        # Send goodbye message
        goodbye_text = f"Echo agent {self.client.agent_id} is going offline. Processed {self.message_count} messages total."
        goodbye = Event(
            event_name="agent.broadcast_message.sent",
            source_id=self.client.agent_id,
            payload={
                "text": goodbye_text,
                "relevant_mod": "openagents.mods.communication.simple_messaging",
                "message_type": "broadcast_message",
            },
            text_representation=goodbye_text,
            requires_response=False,
        )
        await self.client.send_broadcast_message(goodbye)
        logger.info("👋 Sent goodbye message")
