"""
gRPC Network Connector for OpenAgents

Provides gRPC-based connectivity for agents to connect to gRPC networks.
This is an alternative to the WebSocket-based NetworkConnector.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional, Callable, Awaitable, List
import uuid

from openagents.models.messages import DirectMessage, BroadcastMessage, ModMessage
from openagents.models.event import Event
from openagents.utils.message_util import parse_message_dict
from .system_commands import REGISTER_AGENT, LIST_AGENTS, LIST_MODS, GET_MOD_MANIFEST, PING_AGENT, CLAIM_AGENT_ID, VALIDATE_CERTIFICATE, POLL_MESSAGES

logger = logging.getLogger(__name__)


class GRPCNetworkConnector:
    """Handles gRPC network connections and message passing for agents.
    
    This connector allows agents to connect to gRPC-based networks using
    the AgentService gRPC interface.
    """
    
    def __init__(self, host: str, port: int, agent_id: str, metadata: Optional[Dict[str, Any]] = None, max_message_size: int = 104857600):
        """Initialize a gRPC network connector.
        
        Args:
            host: Server host address
            port: Server port
            agent_id: Agent identifier
            metadata: Agent metadata to send during registration
            max_message_size: Maximum message size in bytes (default 100MB)
        """
        self.host = host
        self.port = port
        self.agent_id = agent_id
        self.metadata = metadata or {}
        self.max_message_size = max_message_size
        
        # gRPC components
        self.channel = None
        self.stub = None
        self.stream = None
        self.is_connected = False
        
        # Message handling
        self.message_handlers: Dict[str, List[Callable[[Any], Awaitable[None]]]] = {}
        self.system_handlers = {}
        self.message_listener_task = None
        
        # gRPC modules (loaded on demand)
        self.grpc = None
        self.aio = None
        self.agent_service_pb2 = None
        self.agent_service_pb2_grpc = None
    
    async def _load_grpc_modules(self):
        """Load gRPC modules on demand."""
        if self.grpc is None:
            try:
                import grpc
                from grpc import aio
                from openagents.proto import agent_service_pb2
                from openagents.proto import agent_service_pb2_grpc
                
                self.grpc = grpc
                self.aio = aio
                self.agent_service_pb2 = agent_service_pb2
                self.agent_service_pb2_grpc = agent_service_pb2_grpc
                
                logger.debug("gRPC modules loaded successfully")
                return True
            except ImportError as e:
                logger.error(f"Failed to load gRPC modules: {e}")
                return False
        return True
    
    async def connect_to_server(self) -> bool:
        """Connect to a gRPC network server.
        
        Returns:
            bool: True if connection successful
        """
        try:
            # Load gRPC modules
            if not await self._load_grpc_modules():
                return False
            
            # Create gRPC channel with configuration
            options = [
                ('grpc.keepalive_time_ms', 60000),  # 60 seconds - less aggressive
                ('grpc.keepalive_timeout_ms', 30000),  # 30 seconds
                ('grpc.keepalive_permit_without_calls', False),  # Disable keepalive without calls
                ('grpc.http2_max_pings_without_data', 0),  # Disable pings without data
                ('grpc.http2_min_time_between_pings_ms', 60000),  # 60 seconds between pings
                ('grpc.http2_min_ping_interval_without_data_ms', 300000),  # 5 minutes without data
                ('grpc.max_receive_message_length', self.max_message_size),
                ('grpc.max_send_message_length', self.max_message_size),
            ]
            
            address = f"{self.host}:{self.port}"
            self.channel = self.aio.insecure_channel(address, options=options)
            self.stub = self.agent_service_pb2_grpc.AgentServiceStub(self.channel)
            
            # Test connection with ping
            ping_request = self.agent_service_pb2.PingRequest(
                agent_id=self.agent_id,
                timestamp=self._to_timestamp(time.time())
            )
            
            try:
                ping_response = await self.stub.Ping(ping_request, timeout=5.0)
                if not ping_response.success:
                    logger.error("Server ping failed")
                    return False
            except Exception as e:
                logger.error(f"Failed to ping gRPC server: {e}")
                return False
            
            # Register with server
            register_request = self.agent_service_pb2.RegisterAgentRequest(
                agent_id=self.agent_id,
                metadata=self.metadata,
                capabilities=[]  # TODO: Add capabilities if needed
            )
            
            register_response = await self.stub.RegisterAgent(register_request)
            if not register_response.success:
                logger.error(f"Agent registration failed: {register_response.error_message}")
                return False
            
            logger.info(f"Connected to gRPC network: {register_response.network_name}")
            
            # For now, skip bidirectional streaming and use unary calls
            # TODO: Implement proper streaming later
            self.is_connected = True
            logger.debug("gRPC connection established (using unary calls)")
            
            return True
            
        except Exception as e:
            logger.error(f"gRPC connection error: {e}")
            return False
    
    async def disconnect(self) -> bool:
        """Disconnect from the gRPC network server.
        
        Returns:
            bool: True if disconnection was successful
        """
        try:
            self.is_connected = False
            
            # Cancel message listener task if exists
            if hasattr(self, 'message_listener_task') and self.message_listener_task and not self.message_listener_task.done():
                self.message_listener_task.cancel()
                try:
                    await self.message_listener_task
                except asyncio.CancelledError:
                    pass
            
            # Cancel streaming call if exists
            if hasattr(self, 'stream') and self.stream:
                self.stream.cancel()
                self.stream = None
            
            # Unregister from server
            if self.stub:
                try:
                    unregister_request = self.agent_service_pb2.UnregisterAgentRequest(
                        agent_id=self.agent_id
                    )
                    await self.stub.UnregisterAgent(unregister_request, timeout=5.0)
                except Exception as e:
                    logger.warning(f"Failed to unregister agent: {e}")
            
            # Close channel
            if self.channel:
                await self.channel.close()
                self.channel = None
                self.stub = None
            
            logger.info(f"Agent {self.agent_id} disconnected from gRPC network")
            return True
            
        except Exception as e:
            logger.error(f"Error disconnecting from gRPC network: {e}")
            return False
    
    def register_message_handler(self, message_type: str, handler: Callable[[Any], Awaitable[None]]) -> None:
        """Register a handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: Async function to call when message is received
        """
        if message_type not in self.message_handlers:
            self.message_handlers[message_type] = []
        
        if handler not in self.message_handlers[message_type]:
            self.message_handlers[message_type].append(handler)
            logger.debug(f"Registered gRPC handler for message type: {message_type}")
    
    def unregister_message_handler(self, message_type: str, handler: Callable[[Any], Awaitable[None]]) -> bool:
        """Unregister a handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: The handler function to remove
            
        Returns:
            bool: True if handler was removed, False if not found
        """
        if message_type in self.message_handlers and handler in self.message_handlers[message_type]:
            self.message_handlers[message_type].remove(handler)
            logger.debug(f"Unregistered gRPC handler for message type: {message_type}")
            
            if not self.message_handlers[message_type]:
                del self.message_handlers[message_type]
                
            return True
        return False
    
    def register_system_handler(self, command: str, handler: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
        """Register a handler for a specific system command response.
        
        Args:
            command: Type of system command response to handle
            handler: Async function to call when system response is received
        """
        self.system_handlers[command] = handler
        logger.debug(f"Registered gRPC handler for system command: {command}")
    
    # Note: Streaming methods removed for simplicity
    # TODO: Implement bidirectional streaming for better performance
    
    async def consume_message(self, message: Event) -> None:
        """Consume a message on the agent side.
        
        Args:
            message: Message to consume
        """
        if isinstance(message, ModMessage):
            message.relevant_agent_id = self.agent_id
            
        message_type = message.message_type
        if message_type in self.message_handlers:
            for handler in reversed(self.message_handlers[message_type]):
                try:
                    await handler(message)
                except Exception as e:
                    logger.error(f"Error in gRPC message handler for {message_type}: {e}")
    
    async def send_message(self, message: Event) -> bool:
        """Send an event via gRPC.
        
        Args:
            message: Event to send (now extends Event)
            
        Returns:
            bool: True if event sent successfully, False otherwise
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to gRPC network")
            return False
            
        try:
            # Ensure source_id is set (Event field)
            if not message.source_id:
                message.source_id = self.agent_id
            
            # For ModMessage backward compatibility
            if isinstance(message, ModMessage):
                if not message.relevant_agent_id:
                    message.relevant_agent_id = self.agent_id
            
            # Send event via gRPC
            grpc_message = self._to_grpc_event(message)
            
            # Send the event to the server (using existing SendMessage for now)
            response = await self.stub.SendMessage(grpc_message)  # TODO: Update to SendEvent when protobuf is updated
            
            if response.success:
                logger.debug(f"Successfully sent gRPC event {message.event_id}")
                return True
            else:
                logger.error(f"Failed to send gRPC event {message.event_id}: {response.error_message}")
                return False
                
        except Exception as e:
            logger.error(f"Failed to send gRPC message: {e}")
            return False
    
    async def send_direct_message(self, message: DirectMessage) -> bool:
        """Send a direct message to another agent."""
        return await self.send_message(message)
    
    async def send_broadcast_message(self, message: BroadcastMessage) -> bool:
        """Send a broadcast message to all connected agents."""
        return await self.send_message(message)
    
    async def send_mod_message(self, message: ModMessage) -> bool:
        """Send a mod message to another agent."""
        return await self.send_message(message)
    
    async def send_system_request(self, command: str, **kwargs) -> bool:
        """Send a system request to the gRPC network server.
        
        Args:
            command: The system command to send
            **kwargs: Additional parameters for the command
            
        Returns:
            bool: True if request was sent successfully
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to gRPC network")
            return False
        
        try:
            # Automatically include the agent_id in system requests
            kwargs['agent_id'] = self.agent_id
            
            # Create system command request
            request_data = {
                "command": command,
                "data": kwargs,
                "request_id": str(uuid.uuid4())
            }
            
            # Convert to gRPC format and serialize kwargs to protobuf Any field
            from google.protobuf.any_pb2 import Any
            import json
            
            # Serialize kwargs to Any field
            data_any = Any()
            data_any.type_url = "type.googleapis.com/openagents.SystemCommandData"
            data_any.value = json.dumps(kwargs).encode('utf-8')
            
            system_request = self.agent_service_pb2.SystemCommandRequest(
                command=command,
                request_id=request_data["request_id"],
                data=data_any
            )
            
            response = await self.stub.SendSystemCommand(system_request)
            
            # Process the response data if available
            if response.success and response.data:
                try:
                    import json
                    response_data = json.loads(response.data.value.decode('utf-8'))
                    
                    # Call the registered system handler if available
                    if command in self.system_handlers:
                        logger.info(f"🔧 GRPC: Processing system response for command: {command}")
                        await self.system_handlers[command](response_data)
                    else:
                        logger.debug(f"No handler registered for system command: {command}")
                        
                except Exception as e:
                    logger.error(f"Error processing gRPC system response: {e}")
            
            return response.success
            
        except Exception as e:
            logger.error(f"Failed to send gRPC system request: {e}")
            return False
    
    async def list_agents(self) -> bool:
        """Request a list of agents from the gRPC network server."""
        return await self.send_system_request(LIST_AGENTS)
    
    async def list_mods(self) -> bool:
        """Request a list of mods from the gRPC network server."""
        return await self.send_system_request(LIST_MODS)
    
    async def poll_messages(self) -> List[Dict[str, Any]]:
        """Poll for queued messages from the gRPC network server.
        
        Returns:
            List of messages waiting for this agent
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to gRPC network")
            return []
        
        try:
            # Send poll_messages system request
            success = await self.send_system_request(POLL_MESSAGES)
            if success:
                # The response will be handled by the system command response handler
                # For now, return empty list as this is async
                return []
            else:
                return []
        except Exception as e:
            logger.error(f"Failed to poll messages: {e}")
            return []
    
    def _to_grpc_message(self, message: Event):
        """Convert internal message to gRPC message format."""
        # Create protobuf message
        grpc_message = self.agent_service_pb2.Message(
            message_id=message.message_id,
            sender_id=message.sender_id,
            target_id=getattr(message, 'target_agent_id', '') or getattr(message, 'target_id', ''),
            message_type=message.message_type,
            timestamp=self._to_timestamp(time.time())
        )
        
        # Serialize message content to protobuf Any field
        try:
            from google.protobuf.any_pb2 import Any
            from google.protobuf.struct_pb2 import Struct
            
            # Convert message content to protobuf Struct
            struct = Struct()
            
            # For ModMessage, include mod-specific fields
            if isinstance(message, ModMessage):
                # Include the mod field and other ModMessage attributes
                mod_data = {
                    "mod": message.mod,
                    "action": getattr(message, 'action', None),
                    "direction": getattr(message, 'direction', None),
                    "relevant_agent_id": getattr(message, 'relevant_agent_id', None)
                }
                # Add content
                if message.content:
                    if isinstance(message.content, dict):
                        # Make sure content is JSON serializable
                        serializable_content = self._make_json_serializable(message.content)
                        mod_data.update(serializable_content)
                    else:
                        mod_data["content"] = str(message.content)
                
                struct.update(mod_data)
            else:
                # Handle other message types by serializing all fields
                message_data = {}
                
                # For ProjectNotificationMessage and other special types, include all fields
                if hasattr(message, 'project_id'):
                    message_data["project_id"] = getattr(message, 'project_id', '')
                if hasattr(message, 'notification_type'):
                    message_data["notification_type"] = getattr(message, 'notification_type', '')
                if hasattr(message, 'content'):
                    if isinstance(message.content, dict):
                        message_data["content"] = self._make_json_serializable(message.content)
                    else:
                        message_data["content"] = str(message.content)
                
                # Add any other fields that might be relevant
                for field in ['target_agent_id', 'channel_name', 'action']:
                    if hasattr(message, field):
                        value = getattr(message, field, None)
                        if value is not None:
                            message_data[field] = self._make_json_serializable(value)
                
                if message_data:
                    struct.update(message_data)
                elif hasattr(message, 'content') and message.content:
                    if isinstance(message.content, dict):
                        struct.update(message.content)
                    else:
                        struct.update({"content": str(message.content)})
            
            # Pack into Any
            any_payload = Any()
            any_payload.Pack(struct)
            grpc_message.payload.CopyFrom(any_payload)
            
        except Exception as e:
            logger.warning(f"Failed to serialize message content: {e}")
        
        return grpc_message
    
    def _to_grpc_event(self, event: Event):
        """Convert internal event to gRPC message format (temporary - will be updated with new protobuf)."""
        # For now, convert Event to the existing gRPC message format
        # This will be updated when we update the protobuf definitions
        grpc_message = self.agent_service_pb2.Message(
            message_id=event.event_id,
            sender_id=event.source_id,
            target_id=event.target_agent_id or '',
            message_type=event.event_name,  # Use event_name as message_type
            timestamp=self._to_timestamp(event.timestamp)
        )
        
        # Serialize event data to protobuf Any field
        try:
            from google.protobuf.any_pb2 import Any
            from google.protobuf.struct_pb2 import Struct
            
            # Convert event to protobuf Struct
            struct = Struct()
            event_data = event.to_dict()
            struct.update(self._make_json_serializable(event_data))
            
            # Pack into Any field
            any_field = Any()
            any_field.Pack(struct)
            grpc_message.payload.CopyFrom(any_field)
            
        except Exception as e:
            logger.warning(f"Failed to serialize event content: {e}")
        
        return grpc_message
    
    def _make_json_serializable(self, obj):
        """Convert an object to be JSON serializable, handling gRPC types."""
        import json
        from google.protobuf.struct_pb2 import ListValue, Struct
        from google.protobuf.message import Message
        
        if isinstance(obj, dict):
            return {k: self._make_json_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, ListValue):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, Struct):
            return dict(obj)
        elif isinstance(obj, Message):
            # Convert protobuf message to dict
            from google.protobuf.json_format import MessageToDict
            return MessageToDict(obj)
        elif hasattr(obj, '__dict__'):
            # Handle custom objects by converting to dict
            try:
                return {k: self._make_json_serializable(v) for k, v in obj.__dict__.items()}
            except:
                return str(obj)
        else:
            # Try to serialize directly, fallback to string representation
            try:
                json.dumps(obj)
                return obj
            except (TypeError, ValueError):
                return str(obj)
    
    def _from_grpc_message(self, grpc_message) -> Dict[str, Any]:
        """Convert gRPC message to internal message format."""
        content = {}
        
        # Deserialize message content from protobuf Any field
        try:
            if grpc_message.payload and grpc_message.payload.value:
                from google.protobuf.struct_pb2 import Struct
                
                # Unpack from Any
                struct = Struct()
                if grpc_message.payload.Unpack(struct):
                    # Convert Struct to dict
                    content = dict(struct)
                
        except Exception as e:
            logger.warning(f"Failed to deserialize message content: {e}")
        
        return {
            "type": "message",
            "data": {
                "message_id": grpc_message.message_id,
                "sender_id": grpc_message.sender_id,
                "target_id": grpc_message.target_id,
                "message_type": grpc_message.message_type,
                "content": content,
                "timestamp": self._from_timestamp(grpc_message.timestamp)
            }
        }
    
    def _to_timestamp(self, timestamp: float):
        """Convert Python timestamp to protobuf timestamp."""
        from google.protobuf.timestamp_pb2 import Timestamp
        ts = Timestamp()
        try:
            # Ensure timestamp is in valid range (Unix epoch)
            if timestamp > 1e10:  # Likely milliseconds, convert to seconds
                timestamp = timestamp / 1000.0
            ts.FromSeconds(int(timestamp))
            # Set nanoseconds for the fractional part
            nanos = int((timestamp - int(timestamp)) * 1e9)
            ts.nanos = nanos
        except Exception as e:
            logger.warning(f"Invalid timestamp {timestamp}, using current time: {e}")
            ts.GetCurrentTime()
        return ts
    
    def _from_timestamp(self, timestamp) -> float:
        """Convert protobuf timestamp to Python timestamp."""
        return timestamp.ToSeconds()
    
    # Compatibility methods for existing NetworkConnector interface
    async def wait_mod_message(self, mod_name: str, filter_dict: Optional[Dict[str, Any]] = None, timeout: float = 5.0) -> Optional[ModMessage]:
        """Wait for a mod message from the specified mod that matches the filter criteria."""
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to gRPC network")
            return None
            
        # Create a future to store the response
        response_future = asyncio.Future()
        
        async def temp_mod_handler(msg: ModMessage) -> None:
            # Check if this is the message we're waiting for
            if (msg.mod == mod_name and 
                msg.relevant_agent_id == self.agent_id):
                
                # If filter_dict is provided, check if all key-value pairs match in the content
                if filter_dict:
                    matches = True
                    for key, value in filter_dict.items():
                        if key not in msg.content or msg.content[key] != value:
                            matches = False
                            break
                    
                    if matches:
                        response_future.set_result(msg)
                else:
                    # No filter, accept any message from this mod
                    response_future.set_result(msg)
        
        # Register the temporary handler
        self.register_message_handler("mod_message", temp_mod_handler)
        
        try:
            # Wait for the response with timeout
            try:
                response = await asyncio.wait_for(response_future, timeout)
                return response
            except asyncio.TimeoutError:
                filter_str = f" with filter {filter_dict}" if filter_dict else ""
                logger.warning(f"Timeout waiting for gRPC mod message: {mod_name}{filter_str}")
                return None
                
        finally:
            # Unregister the temporary handler
            self.unregister_message_handler("mod_message", temp_mod_handler)
    
    async def wait_direct_message(self, sender_id: str, timeout: float = 5.0) -> Optional[DirectMessage]:
        """Wait for a direct message from the specified sender."""
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to gRPC network")
            return None
            
        # Create a future to be resolved when the message is received
        response_future = asyncio.Future()
        
        # Create a temporary handler that will resolve the future when the message arrives
        async def temp_direct_handler(msg: DirectMessage) -> None:
            # Check if this is the message we're waiting for
            if msg.sender_id == sender_id:
                response_future.set_result(msg)
        
        # Register the temporary handler
        self.register_message_handler("direct_message", temp_direct_handler)
        
        try:
            # Wait for the response with timeout
            try:
                response = await asyncio.wait_for(response_future, timeout)
                return response
            except asyncio.TimeoutError:
                logger.warning(f"Timeout waiting for gRPC direct message from: {sender_id}")
                return None
                
        finally:
            # Unregister the temporary handler
            self.unregister_message_handler("direct_message", temp_direct_handler)
