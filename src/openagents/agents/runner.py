from abc import ABC, abstractmethod
import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.message_thread import MessageThread
from openagents.models.messages import BaseMessage
from openagents.models.tool import AgentAdapterTool
from openagents.core.client import AgentClient
from openagents.utils.mod_loaders import load_mod_adapters
from openagents.utils.verbose import verbose_print

logger = logging.getLogger(__name__)

class AgentRunner(ABC):
    """Base class for agent runners in OpenAgents.
    
    Agent runners are responsible for managing the agent's lifecycle and handling
    incoming messages from the network. They implement the core logic for how an
    agent should respond to messages and interact with protocols.
    """

    def __init__(self, agent_id: Optional[str] = None, protocol_names: Optional[List[str]] = None, mod_adapters: Optional[List[BaseModAdapter]] = None, client: Optional[AgentClient] = None, interval: Optional[int] = 1, ignored_sender_ids: Optional[List[str]] = None):
        """Initialize the agent runner.
        
        Args:
            agent_id: ID of the agent. Optional, if provided, the runner will use the agent ID to identify the agent.   
            protocol_names: List of protocol names to use for the agent. Optional, if provided, the runner will try to obtain required mod adapters from the server.
            mod_adapters: List of mod adapters to use for the agent. Optional, if provided, the runner will use the provided mod adapters instead of obtaining them from the server.
            client: Agent client to use for the agent. Optional, if provided, the runner will use the client to obtain required mod adapters.
            interval: Interval in seconds between checking for new messages.
            ignored_sender_ids: List of sender IDs to ignore.
            
        Note:
            Either protocol_names or mod_adapters should be provided, not both.
        """
        self._agent_id = agent_id
        self._preset_protocol_names = protocol_names
        self._network_client = client
        self._tools = []
        self._supported_mods = None
        self._running = False
        self._processed_message_ids = set()
        self._interval = interval
        self._ignored_sender_ids = set(ignored_sender_ids) if ignored_sender_ids is not None else set()
        
        # Validate that protocol_names and mod_adapters are not both provided
        if protocol_names is not None and mod_adapters is not None:
            raise ValueError("Cannot provide both protocol_names and mod_adapters. Choose one approach.")
            
        # Initialize the client if it is not provided
        if self._network_client is None:
            if mod_adapters is not None:
                self._network_client = AgentClient(agent_id=self._agent_id, mod_adapters=mod_adapters)
                self._supported_mods = [adapter.protocol_name for adapter in mod_adapters]
            elif self._preset_protocol_names is not None:
                loaded_adapters = load_mod_adapters(self._preset_protocol_names)
                self._network_client = AgentClient(agent_id=self._agent_id, mod_adapters=loaded_adapters)
                self._supported_mods = self._preset_protocol_names
            else:
                self._network_client = AgentClient(agent_id=self._agent_id)
                
        # Update tools if we have mod information
        if self._supported_mods is not None:
            self.update_tools()
    
    def update_tools(self):
        """Update the tools available to the agent.
        
        This method should be called when the available tools might have changed,
        such as after connecting to a server or registering new mod adapters.
        """
        tools = self.client.get_tools()
        # Log info about all available tools
        tool_names = [tool.name for tool in tools]
        logger.info(f"Updated available tools for agent {self._agent_id}: {tool_names}")
        self._tools = tools
    
    @property
    def client(self) -> AgentClient:
        """Get the agent client.
        
        Returns:
            AgentClient: The agent client used by this runner.
        """
        return self._network_client
    
    @property
    def tools(self) -> List[AgentAdapterTool]:
        """Get the tools available to the agent.
        
        Returns:
            List[AgentAdapterTool]: The list of tools available to the agent.
        """
        return self._tools
    
    def get_protocol_adapter(self, protocol_name: str) -> Optional[BaseModAdapter]:
        """Get the mod adapter for the given protocol name.
        
        Returns:
            Optional[BaseModAdapter]: The mod adapter for the given protocol name.
        """
        return self.client.mod_adapters.get(protocol_name)

    @abstractmethod
    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to an incoming message.
        
        This method is called when a new message is received and should implement
        the agent's logic for responding to messages.
        
        Args:
            message_threads: Dictionary of all message threads available to the agent.
            incoming_thread_id: ID of the thread containing the incoming message.
            incoming_message: The incoming message to react to.
        """
    
    async def setup(self):
        """Setup the agent runner.
        
        This method should be called when the agent runner is ready to start receiving messages.
        """
        pass

    async def teardown(self):
        """Teardown the agent runner.
        
        This method should be called when the agent runner is ready to stop receiving messages.
        """
        pass

    async def _async_loop(self):
        """Async implementation of the main loop for the agent runner.
        
        This is the internal async implementation that should not be called directly.
        """
        # print(f"🔄 Agent loop starting for {self._agent_id}...")
        try:    
            while self._running:
                # Get all message threads from the client
                message_threads = self.client.get_messsage_threads()
                # print(f"🔍 Checking for messages... Found {len(message_threads)} threads")
                
                # Find the first unprocessed message across all threads
                unprocessed_message = None
                unprocessed_thread_id = None
                earliest_timestamp = float('inf')
                
                total_messages = 0
                unprocessed_count = 0
                
                for thread_id, thread in message_threads.items():
                    # print(f"   Thread {thread_id}: {len(thread.messages)} messages")
                    for message in thread.messages:
                        total_messages += 1
                        # Check if message hasn't been processed (regardless of requires_response)
                        message_id = str(message.message_id)
                        # print(f"     Message {message_id[:8]}... from {message.sender_id}, requires_response={message.requires_response}, processed={message_id in self._processed_message_ids}")
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
                    # print(f"🎯 Processing message {unprocessed_message.message_id[:8]}... from {unprocessed_message.sender_id}")
                    # Mark the message as processed to avoid processing it again
                    self._processed_message_ids.add(str(unprocessed_message.message_id))

                    # If the sender is in the ignored list, skip the message
                    if unprocessed_message.sender_id in self._ignored_sender_ids:
                        # print(f"⏭️  Skipping message from ignored sender {unprocessed_message.sender_id}")
                        continue
                    
                    # Create a copy of conversation threads that doesn't include future messages
                    current_time = unprocessed_message.timestamp
                    filtered_threads = {}
                    
                    for thread_id, thread in message_threads.items():
                        # Create a new thread with only messages up to the current message's timestamp
                        filtered_thread = MessageThread()
                        filtered_thread.messages = [
                            msg for msg in thread.messages 
                            if msg.timestamp <= current_time
                        ]
                        filtered_threads[thread_id] = filtered_thread
                    
                    # Call react with the filtered threads and the unprocessed message
                    await self.react(filtered_threads, unprocessed_thread_id, unprocessed_message)
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
    
    async def _async_start(self, host: Optional[str] = None, port: Optional[int] = None, network_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None):
        """Async implementation of starting the agent runner.
        
        This is the internal async implementation that should not be called directly.
        """
        try:
            connected = await self.client.connect_to_server(host, port, network_id, metadata)
            if not connected:
                raise Exception("Failed to connect to server")
            
            verbose_print("🔍 AgentRunner getting supported protocols from server...")
            server_supported_mods = await self.client.list_mods()
            verbose_print(f"   Server returned {len(server_supported_mods)} protocols")
            
            protocol_names_requiring_adapters = []
            # Log all supported protocols with their details as JSON
            for protocol_details in server_supported_mods:
                protocol_name = protocol_details["name"]
                protocol_version = protocol_details["version"]
                requires_adapter = protocol_details.get("requires_adapter", True)
                verbose_print(f"   Protocol: {protocol_name} v{protocol_version}, requires_adapter={requires_adapter}")
                if requires_adapter:
                    protocol_names_requiring_adapters.append(protocol_name)
                logger.info(f"Supported protocol: {protocol_name} (v{protocol_version})")
            
            verbose_print(f"📦 Protocols requiring adapters: {protocol_names_requiring_adapters}")
            
            if self._supported_mods is None:
                verbose_print("🔧 Loading mod adapters...")
                self._supported_mods = protocol_names_requiring_adapters
                try:
                    adapters = load_mod_adapters(protocol_names_requiring_adapters) 
                    verbose_print(f"   Loaded {len(adapters)} adapters")
                    for adapter in adapters:
                        self.client.register_mod_adapter(adapter)
                        verbose_print(f"   ✅ Registered adapter: {adapter.protocol_name}")
                    self.update_tools()
                except Exception as e:
                    verbose_print(f"   ❌ Failed to load mod adapters: {e}")
                    import traceback
                    traceback.print_exc()
                    
                # If no protocols were loaded from server, try loading essential protocols manually
                if len(self.client.mod_adapters) == 0:
                    verbose_print("🔧 Server provided no protocols, loading essential protocols manually...")
                    try:
                        manual_adapters = load_mod_adapters(["openagents.mods.communication.simple_messaging"])
                        verbose_print(f"   Manually loaded {len(manual_adapters)} adapters")
                        for adapter in manual_adapters:
                            self.client.register_mod_adapter(adapter)
                            verbose_print(f"   ✅ Manually registered adapter: {adapter.protocol_name}")
                        self.update_tools()
                    except Exception as e:
                        verbose_print(f"   ❌ Failed to manually load mod adapters: {e}")
                        import traceback
                        traceback.print_exc()
            else:
                verbose_print(f"🔄 Using existing protocols: {self._supported_mods}")
            
            self._running = True
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

    async def _async_stop(self):
        """Async implementation of stopping the agent runner.
        
        This is the internal async implementation that should not be called directly.
        """
        try:
            await self.teardown()
        except Exception as e:
            logger.error(f"Error tearing down agent: {e}")
        
        self._running = False
        if hasattr(self, '_loop_task') and self._loop_task:
            try:
                self._loop_task.cancel()
                await asyncio.sleep(0.1)  # Give the task a moment to cancel
            except:
                pass
        await self.client.disconnect()
    
    def start(self, host: Optional[str] = None, port: Optional[int] = None, network_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None):
        """Start the agent runner.
        
        This method should be called when the agent runner is ready to start receiving messages.
        This is a synchronous wrapper around the async implementation.
        
        Args:
            host: Server host
            port: Server port
            network_id: Network ID
            metadata: Additional metadata
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
            loop.run_until_complete(self._async_start(host, port, network_id, metadata))
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
