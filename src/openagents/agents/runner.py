from abc import ABC, abstractmethod
import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from openagents.core.base_protocol_adapter import BaseProtocolAdapter
from openagents.models.message_thread import MessageThread
from openagents.models.messages import BaseMessage
from openagents.models.tool import AgentAdapterTool
from openagents.core.client import AgentClient
from openagents.utils.protocol_loaders import load_protocol_adapters

logger = logging.getLogger(__name__)

class AgentRunner(ABC):
    """Base class for agent runners in OpenAgents.
    
    Agent runners are responsible for managing the agent's lifecycle and handling
    incoming messages from the network. They implement the core logic for how an
    agent should respond to messages and interact with protocols.
    """

    def __init__(self, agent_id: Optional[str] = None, protocol_names: Optional[List[str]] = None, client: Optional[AgentClient] = None, interval: Optional[int] = 1, ignored_sender_ids: Optional[List[str]] = None):
        """Initialize the agent runner.
        
        Args:
            agent_id: ID of the agent. Optional, if provided, the runner will use the agent ID to identify the agent.   
            protocol_names: List of protocol names to use for the agent. Optional, if provided, the runner will try to obtain required protocol adapters from the server.
            client: Agent client to use for the agent. Optional, if provided, the runner will use the client to obtain required protocol adapters.
        """
        self._agent_id = agent_id
        self._preset_protocol_names = protocol_names
        self._network_client = client
        self._tools = []
        self._supported_protocols = None
        self._running = False
        self._processed_message_ids = set()
        self._interval = interval
        self._ignored_sender_ids = set(ignored_sender_ids) if ignored_sender_ids is not None else set()
        # Initialize the client if it is not provided
        if self._network_client is None:
            protocol_adapters = []
            if self._preset_protocol_names is not None:
                protocol_adapters = load_protocol_adapters(self._preset_protocol_names)
            self._network_client = AgentClient(agent_id=self._agent_id, protocol_adapters=protocol_adapters)
        if self._preset_protocol_names is not None:
            self._supported_protocols = self._preset_protocol_names
            self.update_tools()
    
    def update_tools(self):
        """Update the tools available to the agent.
        
        This method should be called when the available tools might have changed,
        such as after connecting to a server or registering new protocol adapters.
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
    
    def get_protocol_adapter(self, protocol_name: str) -> Optional[BaseProtocolAdapter]:
        """Get the protocol adapter for the given protocol name.
        
        Returns:
            Optional[BaseProtocolAdapter]: The protocol adapter for the given protocol name.
        """
        return self.client.protocol_adapters.get(protocol_name)

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
        try:    
            while self._running:
                # Get all message threads from the client
                message_threads = self.client.get_messsage_threads()
                
                # Find the first unprocessed message across all threads
                unprocessed_message = None
                unprocessed_thread_id = None
                earliest_timestamp = float('inf')
                
                for thread_id, thread in message_threads.items():
                    for message in thread.messages:
                        # Check if message requires response and hasn't been processed
                        message_id = str(message.message_id)
                        if (message.requires_response and 
                            message_id not in self._processed_message_ids):
                            # Find the earliest unprocessed message by timestamp
                            if message.timestamp < earliest_timestamp:
                                earliest_timestamp = message.timestamp
                                unprocessed_message = message
                                unprocessed_thread_id = thread_id
                
                # If we found an unprocessed message, process it
                if unprocessed_message and unprocessed_thread_id:
                    # Mark the message as processed to avoid processing it again
                    self._processed_message_ids.add(str(unprocessed_message.message_id))

                    # If the sender is in the ignored list, skip the message
                    if unprocessed_message.sender_id in self._ignored_sender_ids:
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
                
                await asyncio.sleep(self._interval)
        except Exception as e:
            print(f"Agent loop interrupted by exception: {e}")
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
            
            server_supported_protocols = await self.client.list_protocols()
            protocol_names_requiring_adapters = []
            # Log all supported protocols with their details as JSON
            for protocol_details in server_supported_protocols:
                protocol_name = protocol_details["name"]
                protocol_version = protocol_details["version"]
                if protocol_details.get("requires_adapter", True):
                    protocol_names_requiring_adapters.append(protocol_name)
                logger.info(f"Supported protocol: {protocol_name} (v{protocol_version})")
            
            if self._supported_protocols is None:
                self._supported_protocols = protocol_names_requiring_adapters
                adapters = load_protocol_adapters(protocol_names_requiring_adapters) 
                for adapter in adapters:
                    self.client.register_protocol_adapter(adapter)
                self.update_tools()
            
            self._running = True
            # Start the loop in a background task
            self._loop_task = asyncio.create_task(self._async_loop())
            # Setup the agent
            await self.setup()
        except Exception as e:
            print(f"Failed to start agent: {e}")
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
            print(f"Loop interrupted by exception: {e}")
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
