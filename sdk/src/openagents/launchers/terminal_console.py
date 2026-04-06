#!/usr/bin/env python3
"""
OpenAgents Terminal Console

A simple terminal console for interacting with an OpenAgents network.
"""

import asyncio
import logging
import uuid
from typing import Dict, Any, Optional, List

from openagents.core.client import AgentClient
from openagents.models.messages import Event, EventNames
from openagents.utils.verbose import verbose_print

logger = logging.getLogger(__name__)


class ConsoleAgent:
    """Simple console agent for interacting with an OpenAgents network."""

    def __init__(
        self, agent_id: str, host: str, port: int, network_id: Optional[str] = None
    ):
        """Initialize a console agent.

        Args:
            agent_id: Agent ID
            host: Server host address
            port: Server port
            network_id: Optional network ID to connect to
        """
        self.agent_id = agent_id
        self.host = host
        self.port = port
        self.network_id = network_id
        self.agent = AgentClient(agent_id=agent_id)
        self.connected = False
        self.users = {}  # agent_id -> name

        # We'll register message handlers after connection

    async def connect(self) -> bool:
        """Connect to the network server.

        Returns:
            bool: True if connection successful
        """
        metadata = {"name": self.agent_id, "type": "console_agent"}

        success = await self.agent.connect_to_server(
            network_host=self.host,
            network_port=self.port,
            metadata=metadata,
            network_id=self.network_id,
        )
        self.connected = success

        if success and self.agent.connector:
            # Load mod adapters after successful connection
            verbose_print("🔌 Loading mod adapters for console...")
            try:
                from openagents.utils.mod_loaders import load_mod_adapters

                mod_adapters = load_mod_adapters(
                    ["openagents.mods.communication.simple_messaging"]
                )
                for adapter in mod_adapters:
                    self.agent.register_mod_adapter(adapter)
                    verbose_print(f"   ✅ Loaded mod adapter: {adapter.protocol_name}")
            except Exception as e:
                verbose_print(f"   ❌ Failed to load mod adapters: {e}")
                import traceback

                traceback.print_exc()
            # Register message handlers
            self.agent.connector.register_message_handler(
                "direct_message", self._handle_direct_message
            )
            self.agent.connector.register_message_handler(
                "broadcast_message", self._handle_broadcast_message
            )

            # System response handlers are no longer needed - using immediate responses

        return success

    async def disconnect(self) -> bool:
        """Disconnect from the network server.

        Returns:
            bool: True if disconnection successful
        """
        if self.agent.connector:
            success = await self.agent.disconnect()
            self.connected = not success
            return success
        return True

    async def _monitor_connection(self) -> None:
        """Monitor connection health and handle reconnection if needed."""
        while self.connected:
            try:
                # Check if connector is still connected
                if self.agent.connector and not self.agent.connector.is_connected:
                    print("⚠️  Connection lost, attempting to reconnect...")
                    self.connected = False

                    # Try to reconnect
                    if await self.connect():
                        print("✅ Reconnected successfully")
                    else:
                        print("❌ Reconnection failed")
                        break

                # Wait before next check
                await asyncio.sleep(5)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Connection monitor error: {e}")
                await asyncio.sleep(5)

    async def send_direct_message(self, target_id: str, content: str) -> bool:
        """Send a direct message to another agent.

        Args:
            target_id: Target agent ID
            content: Message content

        Returns:
            bool: True if message sent successfully
        """
        if not self.connected:
            print("Not connected to a network server")
            return False

        message = Event(
            sender_id=self.agent_id,
            destination_id=target_id,
            content={"text": content},
            metadata={"type": "text"},
            requires_response=True,
            text_representation=content,
            relevant_mod="openagents.mods.communication.simple_messaging",
            message_type="direct_message",
        )

        verbose_print(f"📤 Console sending direct message to {target_id}: {content}")
        verbose_print(f"   Message ID: {message.message_id}")
        verbose_print(f"   Requires response: {message.requires_response}")
        try:
            await self.agent.send_direct_message(message)
            verbose_print(f"✅ Message sent successfully to {target_id}")
        except Exception as e:
            print(f"❌ Failed to send message to {target_id}: {e}")
            print(f"Exception type: {type(e).__name__}")
            import traceback

            traceback.print_exc()
            return False
        return True

    async def send_broadcast_message(self, content: str) -> bool:
        """Send a broadcast message to all agents.

        Args:
            content: Message content

        Returns:
            bool: True if message sent successfully
        """
        if not self.connected:
            print("Not connected to a network server")
            return False

        message = Event(
            sender_id=self.agent_id,
            content={"text": content},
            metadata={"type": "text"},
            relevant_mod="openagents.mods.communication.simple_messaging",
            message_type="broadcast_message",
            text_representation=content,
            requires_response=False,
        )

        await self.agent.send_broadcast_message(message)
        return True

    # System request methods removed - using AgentClient direct methods with immediate responses

    async def send_system_request(self, command: str, **kwargs) -> bool:
        """Send a system request to the network server.

        Args:
            command: The system command to send
            **kwargs: Additional parameters for the command

        Returns:
            bool: True if request was sent successfully
        """
        if not self.connected:
            print("Not connected to a network server")
            return False

        return await self.agent.send_system_request(command, **kwargs)

    async def _handle_direct_message(self, message: Event) -> None:
        """Handle a direct message from another agent.

        Args:
            message: The message to handle
        """
        sender_id = message.sender_id
        content = message.content.get("text", str(message.content))

        # Update user list if needed
        if sender_id not in self.users and message.metadata.get("name"):
            self.users[sender_id] = message.metadata.get("name")

        # Display the message
        print(f"\n[DM from {sender_id}]: {content}")
        print("> ", end="", flush=True)

    async def _handle_broadcast_message(self, message: Event) -> None:
        """Handle a broadcast message from another agent.

        Args:
            message: The message to handle
        """
        sender_id = message.sender_id
        content = message.content.get("text", str(message.content))

        # Update user list if needed
        if sender_id not in self.users and message.metadata.get("name"):
            self.users[sender_id] = message.metadata.get("name")

        # Display the message
        print(f"\n[Broadcast from {sender_id}]: {content}")
        print("> ", end="", flush=True)

    async def _handle_agent_list(self, agents: List[Dict[str, Any]]) -> None:
        """Handle an agent list response.

        Args:
            agents: List of agent information
        """
        print("\nConnected Agents:")
        print("----------------")
        for agent in agents:
            agent_id = agent.get("agent_id", "Unknown")
            name = agent.get("name", agent_id)
            connected = agent.get("connected", False)
            status = "Connected" if connected else "Disconnected"
            print(f"- {name} ({agent_id}): {status}")
        print("> ", end="", flush=True)

    async def _handle_mod_list(self, protocols: List[Dict[str, Any]]) -> None:
        """Handle a protocol list response.

        Args:
            protocols: List of mod information
        """
        print("\nAvailable Protocols:")
        print("------------------")
        for protocol in protocols:
            name = protocol.get("name", "Unknown")
            description = protocol.get("description", "No description available")
            version = protocol.get("version", "1.0.0")
            print(f"- {name} (v{version}): {description}")
        print("> ", end="", flush=True)

    async def _handle_mod_manifest(self, data: Dict[str, Any]) -> None:
        """Handle a protocol manifest response.

        Args:
            data: Protocol manifest data
        """
        success = data.get("success", False)
        protocol_name = data.get("protocol_name", "unknown")

        if success:
            manifest = data.get("manifest", {})
            print(f"\nProtocol Manifest for {protocol_name}:")
            print("-" * (len(protocol_name) + 22))

            # Display manifest information in a readable format
            print(f"Version: {manifest.get('version', 'Not specified')}")
            print(f"Description: {manifest.get('description', 'Not specified')}")

            if manifest.get("capabilities"):
                print("\nCapabilities:")
                for capability in manifest.get("capabilities", []):
                    print(f"- {capability}")

            if manifest.get("dependencies"):
                print("\nDependencies:")
                for dependency in manifest.get("dependencies", []):
                    print(f"- {dependency}")

            if manifest.get("authors"):
                print("\nAuthors:")
                for author in manifest.get("authors", []):
                    print(f"- {author}")

            if manifest.get("license"):
                print(f"\nLicense: {manifest.get('license')}")

            if manifest.get("network_protocol_class"):
                print(
                    f"\nNetwork Protocol Class: {manifest.get('network_protocol_class')}"
                )

            if manifest.get("agent_protocol_class"):
                print(f"\nAgent Protocol Class: {manifest.get('agent_protocol_class')}")

            if manifest.get("agent_adapter_class"):
                print(f"\nAgent Adapter Class: {manifest.get('agent_adapter_class')}")

            if manifest.get("requires_adapter"):
                print(f"\nRequires Adapter: {manifest.get('requires_adapter')}")

            if manifest.get("metadata"):
                print("\nMetadata:")
                for key, value in manifest.get("metadata", {}).items():
                    print(f"- {key}: {value}")

            if manifest.get("default_config"):
                print("\nDefault Configuration:")
                for key, value in manifest.get("default_config", {}).items():
                    print(f"- {key}: {value}")
        else:
            error = data.get("error", "Unknown error")
            print(f"\nFailed to get manifest for protocol {protocol_name}: {error}")

        print("> ", end="", flush=True)


def show_help_menu() -> None:
    """Display the help menu with available commands."""
    print("Commands:")
    print("  /quit - Exit the console")
    print("  /status - Show connection status")
    print("  /dm <agent_id> <message> - Send a direct message")
    print("  /broadcast <message> - Send a broadcast message")
    print("  /agents - List connected agents")
    print("  /protocols - List available mods")
    print("  /manifest <protocol_name> - Get protocol manifest")
    print("  /help - Show this help message")


async def run_console(
    host: str,
    port: int,
    agent_id: Optional[str] = None,
    network_id: Optional[str] = None,
) -> None:
    """Run a console agent.

    Args:
        host: Server host address
        port: Server port
        agent_id: Optional agent ID (auto-generated if not provided)
        network_id: Optional network ID to connect to
    """
    # Create agent
    agent_id = agent_id or f"ConsoleAgent-{str(uuid.uuid4())[:8]}"

    if network_id:
        host = ""
        port = 0

    console_agent = ConsoleAgent(agent_id, host, port, network_id)

    # Connect to network
    if network_id:
        print(f"Using network ID: {network_id}")
    else:
        print(f"Connecting to network server at {host}:{port}...")

    if not await console_agent.connect():
        print("Failed to connect to the network server. Exiting.")
        return

    # Start connection monitoring task to ensure heartbeat responses
    monitor_task = asyncio.create_task(console_agent._monitor_connection())

    print(f"Connected to network server as {agent_id}")
    print("Type your messages and press Enter to send.")
    show_help_menu()

    # Main console loop
    try:
        while True:
            # Check connection status before waiting for input
            if not console_agent.connected or (
                console_agent.agent.connector
                and not console_agent.agent.connector.is_connected
            ):
                print("⚠️  Connection lost. Exiting.")
                break

            # Get user input
            user_input = await asyncio.get_event_loop().run_in_executor(
                None, input, "> "
            )

            if user_input.strip() == "":
                continue

            if user_input.startswith("/quit"):
                # Exit the console
                break

            elif user_input.startswith("/help"):
                # Show help
                show_help_menu()

            elif user_input.startswith("/status"):
                # Show connection status
                if (
                    console_agent.connected
                    and console_agent.agent.connector
                    and console_agent.agent.connector.is_connected
                ):
                    print("✅ Connection status: Connected")
                    print(f"   Agent ID: {console_agent.agent_id}")
                    print(f"   Server: {console_agent.host}:{console_agent.port}")
                else:
                    print("❌ Connection status: Disconnected")

            elif user_input.startswith("/dm "):
                # Send a direct message
                parts = user_input[4:].strip().split(" ", 1)
                if len(parts) < 2:
                    print("Usage: /dm <agent_id> <message>")
                    continue

                target_id, message = parts
                await console_agent.send_direct_message(target_id, message)
                print(f"[DM to {target_id}]: {message}")

            elif user_input.startswith("/broadcast "):
                # Send a broadcast message
                message = user_input[11:].strip()
                if not message:
                    print("Usage: /broadcast <message>")
                    continue

                await console_agent.send_broadcast_message(message)
                print(f"[Broadcast]: {message}")

            elif user_input.startswith("/agents"):
                # List agents
                agents = await console_agent.agent.list_agents()
                await console_agent._handle_agent_list(agents)

            elif user_input.startswith("/protocols"):
                # List protocols
                mods = await console_agent.agent.list_mods()
                await console_agent._handle_mod_list(mods)

            elif user_input.startswith("/manifest "):
                # Get protocol manifest
                protocol_name = user_input[10:].strip()
                if not protocol_name:
                    print("Usage: /manifest <protocol_name>")
                    continue

                manifest = await console_agent.agent.get_mod_manifest(protocol_name)
                if manifest:
                    await console_agent._handle_mod_manifest(
                        {
                            "success": True,
                            "mod_name": protocol_name,
                            "manifest": manifest,
                        }
                    )
                else:
                    await console_agent._handle_mod_manifest(
                        {
                            "success": False,
                            "mod_name": protocol_name,
                            "error": "Manifest not found",
                        }
                    )

            else:
                # Inform user about available commands
                print("Unknown command. Available commands:")
                show_help_menu()
                print("To send a broadcast message, use /broadcast <message>")

    except KeyboardInterrupt:
        print("\nExiting...")

    finally:
        # Cancel monitoring task
        if "monitor_task" in locals():
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass

        # Disconnect from the network
        await console_agent.disconnect()
        print("Disconnected from the network server")


def launch_console(
    host: str,
    port: int,
    agent_id: Optional[str] = None,
    network_id: Optional[str] = None,
) -> None:
    """Launch a terminal console.

    Args:
        host: Server host address
        port: Server port
        agent_id: Optional agent ID (auto-generated if not provided)
        network_id: Optional network ID to connect to
    """
    try:
        asyncio.run(run_console(host, port, agent_id, network_id))
    except Exception as e:
        logger.error(f"Error in console: {e}")
        import traceback

        traceback.print_exc()
