from abc import ABC, abstractmethod
import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from openagents.agents.orchestrator import orchestrate_agent
from openagents.config.llm_configs import create_model_provider, determine_provider
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.lms.providers import BaseModelProvider
from openagents.models.agent_actions import AgentTrajectory
from openagents.models.agent_config import AgentConfig
from openagents.utils.mcp_connector import MCPConnector
from openagents.models.event_thread import EventThread
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.tool import AgentTool
from openagents.core.client import AgentClient
from openagents.utils.mod_loaders import load_mod_adapters
from openagents.utils.verbose import verbose_print
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class AgentRunner(ABC):
    """Base class for agent runners in OpenAgents.

    Agent runners are responsible for managing the agent's lifecycle and handling
    incoming messages from the network. They implement the core logic for how an
    agent should respond to messages and interact with protocols.
    """

    def __init__(
        self,
        agent_id: Optional[str] = None,
        mod_names: Optional[List[str]] = None,
        mod_adapters: Optional[List[BaseModAdapter]] = None,
        agent_config: Optional[AgentConfig] = None,
        client: Optional[AgentClient] = None,
        interval: Optional[int] = 1,
        ignored_sender_ids: Optional[List[str]] = None,
    ):
        """Initialize the agent runner.

        Args:
            agent_id: ID of the agent. Optional, if provided, the runner will use the agent ID to identify the agent.
            mod_names: List of mod names to use for the agent. Optional, if provided, the runner will try to obtain required mod adapters from the server.
            mod_adapters: List of mod adapters to use for the agent. Optional, if provided, the runner will use the provided mod adapters instead of obtaining them from the server.
            client: Agent client to use for the agent. Optional, if provided, the runner will use the client to obtain required mod adapters.
            interval: Interval in seconds between checking for new messages.
            ignored_sender_ids: List of sender IDs to ignore.

        Note:
            Either mod_names or mod_adapters should be provided, not both.
        """
        self._agent_id = agent_id
        self._preset_mod_names = mod_names
        self._network_client = client
        self._tools = []
        self._mcp_tools = []
        self._mod_tools = []
        self._supported_mods = None
        self._running = False
        self._processed_message_ids = set()
        self._interval = interval
        self._agent_config = agent_config
        self._ignored_sender_ids = (
            set(ignored_sender_ids) if ignored_sender_ids is not None else set()
        )
        
        # MCP (Model Context Protocol) client management
        self._mcp_connector = MCPConnector()

        # Validate that mod_names and mod_adapters are not both provided
        if mod_names is not None and mod_adapters is not None:
            raise ValueError(
                "Cannot provide both mod_names and mod_adapters. Choose one approach."
            )

        # Initialize the client if it is not provided
        if self._network_client is None:
            if mod_adapters is not None:
                self._network_client = AgentClient(
                    agent_id=self._agent_id, mod_adapters=mod_adapters
                )
                self._supported_mods = [adapter.mod_name for adapter in mod_adapters]
            elif self._preset_mod_names is not None:
                loaded_adapters = load_mod_adapters(self._preset_mod_names)
                self._network_client = AgentClient(
                    agent_id=self._agent_id, mod_adapters=loaded_adapters
                )
                self._supported_mods = self._preset_mod_names
            else:
                self._network_client = AgentClient(agent_id=self._agent_id)

        # Update tools if we have mod information
        if self._supported_mods is not None:
            self.update_tools()

    @property
    def agent_id(self) -> str:
        """Get the agent ID."""
        return self.client.agent_id

    def update_tools(self):
        """Update the tools available to the agent.

        This method should be called when the available tools might have changed,
        such as after connecting to a server or registering new mod adapters.
        """
        self._mod_tools = self.client.get_tools()
        # Add MCP tools if available
        self._mcp_tools = self._mcp_connector.get_mcp_tools()

        all_tools = self._mod_tools + self._mcp_tools
        
        # Log info about all available tools
        tool_names = [tool.name for tool in all_tools]
        logger.info(f"Updated available tools for agent {self._agent_id}: {tool_names}")
        self._tools = all_tools

    @staticmethod
    def from_yaml(
        yaml_path: str, 
        agent_id_override: Optional[str] = None,
        connection_override: Optional[Dict[str, Any]] = None
    ) -> "AgentRunner":
        """Create an agent runner from a YAML file.

        This method loads a WorkerAgent (which is a type of AgentRunner) from a YAML
        configuration file using the agent_loader utility function.

        Args:
            yaml_path: The path to the YAML configuration file
            agent_id_override: Optional agent ID to override the one in config
            connection_override: Optional connection settings to override config

        Returns:
            AgentRunner: A configured WorkerAgent instance (subclass of AgentRunner)

        Raises:
            FileNotFoundError: If YAML file doesn't exist
            ValueError: If configuration is invalid
            ImportError: If specified agent class cannot be imported

        Example:
            agent = AgentRunner.from_yaml("my_worker_config.yaml")
            await agent.async_start(host="localhost", port=8570)
        """
        from openagents.utils.agent_loader import load_agent_from_yaml

        # Load the agent using our utility function (ignore connection settings here)
        agent, _ = load_agent_from_yaml(yaml_path, agent_id_override, connection_override)
        return agent

    @property
    def agent_config(self) -> AgentConfig:
        """Get the agent config.

        Returns:
            AgentConfig: The agent config used by this runner.
        """
        return self._agent_config

    @property
    def client(self) -> AgentClient:
        """Get the agent client.

        Returns:
            AgentClient: The agent client used by this runner.
        """
        return self._network_client

    @property
    def tools(self) -> List[AgentTool]:
        """Get the tools available to the agent.

        Returns:
            List[AgentAdapterTool]: The list of tools available to the agent.
        """
        return self._tools

    def get_mod_adapter(self, mod_name: str) -> Optional[BaseModAdapter]:
        """Get the mod adapter for the given mod name.

        Returns:
            Optional[BaseModAdapter]: The mod adapter for the given mod name.
        """
        return self.client.mod_adapters.get(mod_name)

    @abstractmethod
    async def react(self, context: EventContext):
        """React to an incoming message.

        This method is called when a new message is received and should implement
        the agent's logic for responding to messages.

        Args:
            context: The event context containing the incoming event, event threads, and thread ID.
        """

    async def run_agent(
        self,
        context: EventContext,
        instruction: Optional[str] = None,
        max_iterations: Optional[int] = None,
        disable_mcp: Optional[bool] = False,
        disable_mods: Optional[bool] = False,
    ) -> AgentTrajectory:
        """
        Let the agent respond to the context and decide it's action automatically.

        Args:
            context: The event context containing incoming event, threads, and thread ID
            user_instruction: The instruction for the agent to respond to the context
            max_iterations: The maximum number of iterations for the agent to respond to the context
            disable_mcp: Whether to disable MCP tools
            disable_mods: Whether to disable network interaction with mods
        """
        # Get tools from MCP and mods
        tools = []
        if not disable_mcp:
            tools.extend(self._mcp_tools)
        if not disable_mods:
            tools.extend(self._mod_tools)
        
        return await orchestrate_agent(
            context=context,
            agent_config=self.agent_config,
            tools=tools,
            user_instruction=instruction,
            max_iterations=max_iterations,  
        )
    
    def get_llm(self) -> BaseModelProvider:
        """Get the LLM provider for the agent."""
        agent_config = self.agent_config
        provider = determine_provider(
            agent_config.provider, agent_config.model_name, agent_config.api_base
        )
        model_provider = create_model_provider(
            provider=provider,
            model_name=agent_config.model_name,
            api_base=agent_config.api_base,
            api_key=agent_config.api_key,
        )
        return model_provider
    
    async def run_llm(
        self,
        context: EventContext,
        instruction: Optional[str] = None,
        max_iterations: Optional[int] = None,
        disable_mcp: Optional[bool] = False,
    ) -> AgentTrajectory:
        """
        Run the LLM to generate a response based on the context and instruction.
        This method will not call tools for interacting with mods or the network.
        """
        tools = []
        if not disable_mcp:
            tools.extend(self._mcp_tools)
        return await orchestrate_agent(
            context=context,
            agent_config=self.agent_config,
            tools=tools,
            user_instruction=instruction,
            max_iterations=max_iterations,
            disable_finish_tool=True,
            use_llm_user_prompt=True,
        )
    
    async def send_event(self, event: Event) -> Optional[EventResponse]:
        """Send an event to the network."""
        if event.source_id is None:
            event.source_id = self.agent_id
        if event.destination_id is None:
            event.destination_id = "agent:broadcast"
        return await self.client.send_event(event)

    async def setup(self):
        """Setup the agent runner.

        This method should be called when the agent runner is ready to start receiving messages.
        """
        # Setup MCP clients if configured
        if self._agent_config and self._agent_config.mcps:
            await self._setup_mcp_clients()
        pass

    async def teardown(self):
        """Teardown the agent runner.

        This method should be called when the agent runner is ready to stop receiving messages.
        """
        # Cleanup MCP clients
        await self._mcp_connector.cleanup_mcp_clients()

    async def _setup_mcp_clients(self):
        """Setup MCP (Model Context Protocol) clients based on configuration."""
        if not self._agent_config or not self._agent_config.mcps:
            return

        # Setup MCP clients using the connector
        await self._mcp_connector.setup_mcp_clients(self._agent_config.mcps)
        
        # Update tools after setting up MCP clients
        self.update_tools()

    def get_mcp_tools(self) -> List[AgentTool]:
        """Get all tools from connected MCP servers."""
        return self._mcp_connector.get_mcp_tools()

    def get_mcp_clients(self) -> Dict[str, Any]:
        """Get all connected MCP clients."""
        return self._mcp_connector.get_mcp_clients()
    
    def get_cached_event(self, event_id: str) -> Optional[Event]:
        """Get an event by its ID from the cache."""
        return self.client.get_cached_event(event_id)

    async def _async_loop(self):
        """Async implementation of the main loop for the agent runner.

        This is the internal async implementation that should not be called directly.
        """
        # print(f"🔄 Agent loop starting for {self._agent_id}...")
        try:
            while self._running:
                # Get all message threads from the client
                event_threads = self.client.get_event_threads()
                logger.debug(
                    f"🔍 AGENT_RUNNER: Checking for messages... Found {len(event_threads)} threads"
                )

                # Find the first unprocessed message across all threads
                unprocessed_message = None
                unprocessed_thread_id = None
                earliest_timestamp = float("inf")

                total_messages = 0
                unprocessed_count = 0

                for thread_id, thread in event_threads.items():
                    print(f"   Thread {thread_id}: {len(thread.events)} messages")
                    for message in thread.events:
                        total_messages += 1
                        # Check if message hasn't been processed (regardless of requires_response)
                        message_id = str(message.message_id)
                        print(
                            f"     Message {message_id[:8]}... from {message.source_id}, processed={message_id in self._processed_message_ids}"
                        )
                        if message_id not in self._processed_message_ids:
                            unprocessed_count += 1
                            # Find the earliest unprocessed message by timestamp
                            if message.timestamp < earliest_timestamp:
                                earliest_timestamp = message.timestamp
                                unprocessed_message = message
                                unprocessed_thread_id = thread_id

                # print(f"📊 Total messages: {total_messages}, Unprocessed: {unprocessed_count}")

                # If we found an unprocessed message, process it
                if unprocessed_message and unprocessed_thread_id:
                    print(
                        f"🔧 AGENT_RUNNER: Found unprocessed message {unprocessed_message.message_id[:8]}... from {unprocessed_message.source_id}"
                    )
                    print(
                        f"🎯 Processing message {unprocessed_message.message_id[:8]}... from {unprocessed_message.source_id}"
                    )
                    # logger.info(f"🔧 AGENT_RUNNER: Found unprocessed message {unprocessed_message.message_id[:8]}... from {unprocessed_message.source_id}")
                    # print(f"🎯 Processing message {unprocessed_message.message_id[:8]}... from {unprocessed_message.source_id}")
                    # Mark the message as processed to avoid processing it again
                    self._processed_message_ids.add(str(unprocessed_message.message_id))

                    # If the sender is in the ignored list, skip the message
                    if unprocessed_message.source_id in self._ignored_sender_ids:
                        # print(f"⏭️  Skipping message from ignored sender {unprocessed_message.source_id}")
                        continue

                    # Create a copy of conversation threads that doesn't include future messages
                    current_time = unprocessed_message.timestamp
                    filtered_threads = {}

                    for thread_id, thread in event_threads.items():
                        # Create a new thread with only messages up to the current message's timestamp
                        filtered_thread = EventThread()
                        filtered_thread.events = [
                            msg
                            for msg in thread.events
                            if msg.timestamp <= current_time
                        ]
                        filtered_threads[thread_id] = filtered_thread

                    # Create EventContext and call react
                    context = EventContext(
                        incoming_event=unprocessed_message,
                        event_threads=filtered_threads,
                        incoming_thread_id=unprocessed_thread_id,
                    )
                    print(
                        f"🔧 AGENT_RUNNER: Calling react method for message {unprocessed_message.message_id[:8]}..."
                    )
                    await self.react(context)
                    print(
                        f"🔧 AGENT_RUNNER: react method completed for message {unprocessed_message.message_id[:8]}"
                    )
                else:
                    await asyncio.sleep(self._interval or 1)
                    # print("😴 No unprocessed messages found, sleeping...")

        except Exception as e:
            verbose_print(f"💥 Agent loop interrupted by exception: {e}")
            verbose_print(f"Exception type: {type(e).__name__}")
            import traceback

            traceback.print_exc()
            # Ensure the agent is stopped when the loop is interrupted
            await self._async_stop()
            # Re-raise the exception after cleanup
            raise

    async def _async_start(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        network_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        password_hash: Optional[str] = None,
    ):
        """Async implementation of starting the agent runner.

        This is the internal async implementation that should not be called directly.
        """
        # verbose_print(f"🚀 Agent {self._agent_id} starting...")
        try:
            connected = await self.client.connect(
                network_host=host,
                network_port=port,
                network_id=network_id,
                metadata=metadata,
                password_hash=password_hash,
            )
            if not connected:
                raise Exception("Failed to connect to server")

            verbose_print("🔍 AgentRunner getting supported protocols from server...")
            server_supported_mods = await self.client.list_mods()
            verbose_print(f"   Server returned {len(server_supported_mods)} protocols")

            mod_names_requiring_adapters = []
            # Log all supported protocols with their details as JSON
            for protocol_details in server_supported_mods:
                mod_name = protocol_details["name"]
                protocol_version = protocol_details["version"]
                requires_adapter = protocol_details.get("requires_adapter", True)
                verbose_print(
                    f"   Mod: {mod_name} v{protocol_version}, requires_adapter={requires_adapter}"
                )
                if requires_adapter:
                    mod_names_requiring_adapters.append(mod_name)
                logger.info(f"Supported mod: {mod_name} (v{protocol_version})")

            verbose_print(f"📦 Mods requiring adapters: {mod_names_requiring_adapters}")

            if self._supported_mods is None:
                verbose_print("🔧 Loading mod adapters...")
                self._supported_mods = mod_names_requiring_adapters
                try:
                    adapters = load_mod_adapters(mod_names_requiring_adapters)
                    verbose_print(f"   Loaded {len(adapters)} adapters")
                    for adapter in adapters:
                        self.client.register_mod_adapter(adapter)
                        verbose_print(f"   ✅ Registered adapter: {adapter.mod_name}")
                    self.update_tools()
                except Exception as e:
                    verbose_print(f"   ❌ Failed to load mod adapters: {e}")
                    import traceback

                    traceback.print_exc()

                # If no protocols were loaded from server, try loading essential protocols manually
                if len(self.client.mod_adapters) == 0:
                    verbose_print(
                        "🔧 Server provided no protocols, loading essential protocols manually..."
                    )
                    try:
                        # Load essential protocols, including any specified in mod_names
                        essential_mods = [
                            "openagents.mods.communication.simple_messaging"
                        ]
                        if (
                            hasattr(self, "_preset_mod_names")
                            and self._preset_mod_names
                        ):
                            essential_mods.extend(self._preset_mod_names)

                        # Remove duplicates while preserving order
                        essential_mods = list(dict.fromkeys(essential_mods))

                        manual_adapters = load_mod_adapters(essential_mods)
                        verbose_print(
                            f"   Manually loaded {len(manual_adapters)} adapters"
                        )
                        for adapter in manual_adapters:
                            self.client.register_mod_adapter(adapter)
                            verbose_print(
                                f"   ✅ Manually registered adapter: {adapter.mod_name}"
                            )
                        self.update_tools()
                    except Exception as e:
                        verbose_print(
                            f"   ❌ Failed to manually load mod adapters: {e}"
                        )
                        import traceback

                        traceback.print_exc()

                # Also try to load any missing preset mod_names that weren't loaded from server
                if hasattr(self, "_preset_mod_names") and self._preset_mod_names:
                    loaded_mod_names = [
                        adapter.mod_name
                        for adapter in self.client.mod_adapters.values()
                    ]
                    verbose_print(f"🔧 Preset mod names: {self._preset_mod_names}")
                    verbose_print(f"🔧 Loaded mod names: {loaded_mod_names}")
                    missing_mods = [
                        mod
                        for mod in self._preset_mod_names
                        if mod not in loaded_mod_names
                    ]

                    if missing_mods:
                        verbose_print(f"🔧 Loading missing preset mods: {missing_mods}")
                        try:
                            additional_adapters = load_mod_adapters(missing_mods)
                            verbose_print(
                                f"   Loaded {len(additional_adapters)} additional adapters"
                            )
                            for adapter in additional_adapters:
                                self.client.register_mod_adapter(adapter)
                                verbose_print(
                                    f"   ✅ Registered additional adapter: {adapter.mod_name}"
                                )
                            self.update_tools()
                        except Exception as e:
                            verbose_print(
                                f"   ❌ Failed to load additional mod adapters: {e}"
                            )
                            import traceback

                            traceback.print_exc()
                    else:
                        verbose_print(f"🔧 All preset mods already loaded")
            else:
                verbose_print(f"🔄 Using existing protocols: {self._supported_mods}")

            self._running = True
            # Start the loop in a background task
            # Start the loop in a background task
            self._loop_task = asyncio.create_task(self._async_loop())
            # Setup the agent
            await self.setup()
        except Exception as e:
            verbose_print(f"Failed to start agent: {e}")
            # Ensure the agent is stopped if there's an exception during startup
            await self._async_stop()
            # Re-raise the exception after cleanup
            raise

    async def _async_wait_for_stop(self):
        """Async implementation of waiting for the agent runner to stop.

        This is the internal async implementation that should not be called directly.
        """
        try:
            # Create a future that will be completed when the agent is stopped
            stop_future = asyncio.get_event_loop().create_future()

            # Define a task to check if the agent is still running
            async def check_running():
                while self._running:
                    await asyncio.sleep(0.1)
                stop_future.set_result(None)

            # Start the checking task
            check_task = asyncio.create_task(check_running())

            # Wait for the future to complete (when the agent stops)
            await stop_future

            # Clean up the task
            check_task.cancel()
        except KeyboardInterrupt:
            # Handle keyboard interrupt by stopping the agent
            await self._async_stop()
            # Wait a moment for cleanup
            await asyncio.sleep(0.5)
        except Exception as e:
            # Handle any other exception by stopping the agent
            verbose_print(f"Loop interrupted by exception: {e}")
            await self._async_stop()
            # Wait a moment for cleanup
            await asyncio.sleep(0.5)
            # Re-raise the exception after cleanup
            raise

    async def async_start(
        self,
        network_host: Optional[str] = None,
        network_port: Optional[int] = None,
        network_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Public async method for starting the agent runner.

        This is the public async API that should be used when starting agents in async contexts.

        Args:
            host: Server host to connect to
            port: Server port to connect to
            network_id: Network ID to join
            metadata: Additional metadata for the agent

        Raises:
            Exception: If the agent fails to start or connect
        """
        await self._async_start(network_host, network_port, network_id, metadata)

    async def _async_stop(self):
        """Async implementation of stopping the agent runner.

        This is the internal async implementation that should not be called directly.
        """
        try:
            await self.teardown()
        except Exception as e:
            logger.error(f"Error tearing down agent: {e}")

        self._running = False
        if hasattr(self, "_loop_task") and self._loop_task:
            try:
                self._loop_task.cancel()
                await asyncio.sleep(0.1)  # Give the task a moment to cancel
            except:
                pass
        await self.client.disconnect()

    async def async_stop(self):
        """Public async method for stopping the agent runner.

        This is the public async API that should be used when stopping agents in async contexts.
        """
        await self._async_stop()

    def start(
        self,
        network_host: Optional[str] = None,
        network_port: Optional[int] = None,
        network_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        password_hash: Optional[str] = None,
    ):
        """Start the agent runner.

        This method should be called when the agent runner is ready to start receiving messages.
        This is a synchronous wrapper around the async implementation.

        Args:
            host: Server host
            port: Server port
            network_id: Network ID
            metadata: Additional metadata
            password_hash: Password hash for agent group authentication
        """
        # Create a new event loop if one doesn't exist
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # No event loop in current thread, create a new one
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        # Run the async start method in the event loop
        try:
            loop.run_until_complete(self._async_start(network_host, network_port, network_id, metadata, password_hash))
        except Exception as e:
            raise Exception(f"Failed to start agent: {str(e)}")

    def wait_for_stop(self):
        """Wait for the agent runner to stop.

        This method will block until the agent runner is stopped.
        This is a synchronous wrapper around the async implementation.
        """
        # Get the current event loop
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # No event loop in current thread, create a new one
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        # Run the async wait_for_stop method in the event loop
        try:
            loop.run_until_complete(self._async_wait_for_stop())
        except KeyboardInterrupt:
            # Handle keyboard interrupt by stopping the agent
            self.stop()
        except Exception as e:
            raise Exception(f"Error waiting for agent to stop: {str(e)}")

    def stop(self):
        """Stop the agent runner.

        This method should be called when the agent runner is ready to stop receiving messages.
        This is a synchronous wrapper around the async implementation.
        """
        # Get the current event loop
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # No event loop in current thread, create a new one
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        # Run the async stop method in the event loop
        try:
            loop.run_until_complete(self._async_stop())
        except Exception as e:
            print(f"Error stopping agent: {e}")

    def send_human_message(self, message: str):
        # TODO: Implement this
        pass
