"""
HTTP adapter for gRPC transport to support browser clients.
Provides REST endpoints that map to gRPC calls for web compatibility.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, List, Optional
from aiohttp import web, WSMsgType
import uuid

logger = logging.getLogger(__name__)


class GRPCHTTPAdapter:
    """HTTP adapter that provides REST endpoints for gRPC transport."""
    
    def __init__(self, transport):
        self.transport = transport
        self.app = web.Application()
        self.message_queues: Dict[str, List[Dict[str, Any]]] = {}  # agent_id -> messages
        self.setup_routes()
    
    def setup_routes(self):
        """Setup HTTP routes."""
        self.app.router.add_post('/api/register', self.register_agent)
        self.app.router.add_post('/api/unregister', self.unregister_agent)
        self.app.router.add_get('/api/poll/{agent_id}', self.poll_messages)
        self.app.router.add_post('/api/send_message', self.send_message)
        self.app.router.add_post('/api/system_command', self.system_command)
        self.app.router.add_post('/api/add_reaction', self.add_reaction)
        
        # Workspace API endpoints
        self.app.router.add_post('/api/workspace/channels', self.workspace_channels)
        self.app.router.add_post('/api/workspace/messages', self.workspace_messages)
        self.app.router.add_post('/api/workspace/agents', self.workspace_agents)
        self.app.router.add_post('/api/workspace/react', self.workspace_react)
        
        # Event subscription endpoints
        self.app.router.add_post('/api/events/subscribe', self.events_subscribe)
        self.app.router.add_post('/api/events/unsubscribe', self.events_unsubscribe)
        
        # CORS middleware
        self.app.middlewares.append(self.cors_handler)
    
    @web.middleware
    async def cors_handler(self, request, handler):
        """Handle CORS for browser requests."""
        if request.method == 'OPTIONS':
            response = web.Response()
        else:
            response = await handler(request)
        
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response
    
    async def register_agent(self, request):
        """Register an agent via HTTP."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            metadata = data.get('metadata', {})
            capabilities = data.get('capabilities', [])
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error': 'agent_id is required'
                }, status=400)
            
            # Initialize message queue for agent
            self.message_queues[agent_id] = []
            
            # Notify transport about agent registration
            system_message = {
                'command': 'register_agent',
                'data': {
                    'agent_id': agent_id,
                    'metadata': metadata,
                    'capabilities': capabilities,
                    'force_reconnect': True  # Allow reconnection for HTTP agents
                }
            }
            
            # Create a mock context for the HTTP request
            class MockContext:
                def peer(self):
                    return f"{request.remote}:{request.transport.get_extra_info('peername')[1] if request.transport else 'unknown'}"
            
            await self.transport._notify_system_message_handlers(
                agent_id, system_message, MockContext()
            )
            
            return web.json_response({
                'success': True,
                'network_name': 'OpenAgents Network',
                'network_id': 'grpc-http-network'
            })
            
        except Exception as e:
            logger.error(f"Error in register_agent: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def unregister_agent(self, request):
        """Unregister an agent via HTTP."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error': 'agent_id is required'
                }, status=400)
            
            # Remove message queue
            self.message_queues.pop(agent_id, None)
            
            return web.json_response({'success': True})
            
        except Exception as e:
            logger.error(f"Error in unregister_agent: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def poll_messages(self, request):
        """Poll for messages for an agent."""
        try:
            agent_id = request.match_info['agent_id']
            
            # Get messages from queue
            messages = self.message_queues.get(agent_id, [])
            
            # Clear the queue after retrieving messages
            self.message_queues[agent_id] = []
            
            # Ensure messages are JSON serializable
            serializable_messages = []
            for message in messages:
                try:
                    serializable_message = self._make_json_serializable(message)
                    serializable_messages.append(serializable_message)
                except Exception as e:
                    logger.warning(f"Failed to serialize message for agent {agent_id}: {e}")
                    # Skip non-serializable messages
                    continue
            
            return web.json_response({
                'success': True,
                'messages': serializable_messages
            })
            
        except Exception as e:
            logger.error(f"Error in poll_messages: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def send_message(self, request):
        """Send a message via HTTP."""
        try:
            data = await request.json()
            
            # Check if we have network instance for thread messaging
            if hasattr(self.transport, 'network_instance') and self.transport.network_instance:
                # Create mod message for thread messaging
                from openagents.models.messages import Event, EventNames
                
                message_type = data.get('message_type', 'direct_message')
                message_id = str(uuid.uuid4())
                
                # Create appropriate message content based on type
                if message_type == 'channel_message':
                    mod_content = {
                        "message_type": "channel_message",
                        "sender_id": data.get('sender_id'),
                        "channel": data.get('channel', 'general'),
                        "content": data.get('content', {}),
                        "reply_to_id": data.get('reply_to_id'),
                        "quoted_message_id": data.get('quoted_message_id'),
                        "quoted_text": data.get('quoted_text')
                    }
                else:
                    mod_content = {
                        "message_type": "direct_message",
                        "sender_id": data.get('sender_id'),
                        "target_agent_id": data.get('target_agent_id'),
                        "content": data.get('content', {}),
                        "reply_to_id": data.get('reply_to_id'),
                        "quoted_message_id": data.get('quoted_message_id'),
                        "quoted_text": data.get('quoted_text')
                    }
                
                mod_message = Event(
                    event_name="thread.message",
                    source_id=data.get('sender_id'),
                    relevant_mod="openagents.mods.communication.thread_messaging",
                    target_agent_id=data.get('sender_id'),
                    payload=mod_content,
                    timestamp=int(time.time())
                )
                
                # Send through network's mod message handler
                await self.transport.network_instance._handle_mod_message(mod_message)
                
                return web.json_response({
                    'success': True,
                    'message_id': mod_message.message_id  # Use backward compatibility property
                })
            else:
                # Fallback to transport message if no network instance
                from openagents.models.transport import TransportMessage
                
                message = TransportMessage(
                    source_id=data.get('sender_id'),
                    target_id=data.get('target_agent_id'),
                    message_type=data.get('message_type', 'direct_message'),
                    payload={
                        'content': data.get('content', {}),
                        'channel': data.get('channel'),
                        'reply_to_id': data.get('reply_to_id'),
                        'quoted_message_id': data.get('quoted_message_id'),
                        'quoted_text': data.get('quoted_text')
                    },
                    timestamp=int(time.time()),
                    metadata={}
                )
                
                # Send through transport
                success = await self.transport.send(message)
                
                return web.json_response({
                    'success': success,
                    'message_id': message.message_id
                })
            
        except Exception as e:
            logger.error(f"Error in send_message: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def system_command(self, request):
        """Handle system commands via HTTP."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            command = data.get('command')
            command_data = data.get('data', {})
            
            # Create system message
            system_message = {
                'command': command,
                'data': command_data
            }
            
            # Create mock context
            class MockContext:
                def peer(self):
                    return f"{request.remote}:unknown"
            
            # Handle the system command and queue response
            response_data = await self._handle_system_command(
                agent_id, command, command_data
            )
            
            # Queue response for the agent
            if agent_id and agent_id in self.message_queues:
                self.message_queues[agent_id].append({
                    'message_type': 'system_response',
                    'command': command,
                    'data': response_data,
                    'timestamp': time.time()
                })
            
            return web.json_response({'success': True})
            
        except Exception as e:
            logger.error(f"Error in system_command: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def add_reaction(self, request):
        """Add a reaction to a message."""
        try:
            data = await request.json()
            
            # For now, just return success
            # This would integrate with the mod system
            return web.json_response({'success': True})
            
        except Exception as e:
            logger.error(f"Error in add_reaction: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def _handle_system_command(self, agent_id: str, command: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle system commands by forwarding to the network instance."""
        try:
            # Forward the system command to the network instance if available
            if hasattr(self.transport, 'network_instance') and self.transport.network_instance:
                network = self.transport.network_instance
                
                # Handle list_agents command directly
                if command == 'list_agents':
                    agent_list = []
                    for agent_id_key, metadata in network.agents.items():
                        # Create a copy of metadata and set the status based on connection
                        agent_metadata = metadata.copy()
                        is_connected = agent_id_key in network.connections
                        agent_metadata['status'] = 'online' if is_connected else 'offline'
                        
                        agent_info = {
                            "agent_id": agent_id_key,
                            "name": metadata.get("name", agent_id_key),
                            "connected": is_connected,
                            "metadata": agent_metadata
                        }
                        agent_list.append(agent_info)
                    
                    # Queue the response for the requesting agent
                    response_message = {
                        'message_type': 'system_response',
                        'command': 'list_agents',
                        'data': {'agents': agent_list},
                        'timestamp': time.time()
                    }
                    
                    if agent_id not in self.message_queues:
                        self.message_queues[agent_id] = []
                    self.message_queues[agent_id].append(response_message)
                    
                    return {'success': True, 'agents': agent_list}
                
                # Handle thread messaging commands by converting to mod messages
                if command in ['get_channel_messages', 'list_channels', 'react_to_message', 'send_channel_message']:
                    return await self._handle_thread_messaging_command(agent_id, command, data)
                
                # Handle mod checking command
                if command == 'check_mod':
                    return await self._handle_check_mod_command(agent_id, data)
                
                # Handle shared document commands by converting to mod messages
                if command in ['create_document', 'open_document', 'close_document', 'list_documents', 
                              'get_document_content', 'get_document_history', 'get_agent_presence',
                              'insert_lines', 'remove_lines', 'replace_lines', 'add_comment', 
                              'remove_comment', 'update_cursor_position', 'acquire_line_lock', 'release_line_lock']:
                    return await self._handle_shared_document_command(agent_id, command, data)
                
                # Handle other system commands by creating a system message
                system_message = {
                    "command": command,
                    "data": data
                }
                
                # Create a mock connection object for HTTP adapter
                class MockConnection:
                    def __init__(self, agent_id, message_queues):
                        self.agent_id = agent_id
                        self.message_queues = message_queues
                    
                    async def send(self, message_str):
                        """Queue message for polling."""
                        message = json.loads(message_str)
                        if self.agent_id not in self.message_queues:
                            self.message_queues[self.agent_id] = []
                        self.message_queues[self.agent_id].append(message)
                
                mock_connection = MockConnection(agent_id, self.message_queues)
                
                # Forward to network instance system message handler
                await network._handle_system_message(agent_id, system_message, mock_connection)
                
                return {'success': True, 'forwarded': True}
            
            # Fallback to mock data if network instance is not available
            if command == 'list_channels':
                # Mock channel data for now
                return {
                    'channels': [
                        {
                            'name': 'general',
                            'description': 'General discussion',
                            'agents': [],
                            'message_count': 0,
                            'thread_count': 0
                        },
                        {
                            'name': 'documents',
                            'description': 'Document collaboration',
                            'agents': [],
                            'message_count': 0,
                            'thread_count': 0
                        }
                    ]
                }
            elif command == 'get_channel_messages':
                # Mock message data
                return {
                    'messages': [],
                    'channel': data.get('channel', 'general')
                }
            elif command == 'get_direct_messages':
                # Mock direct messages
                return {
                    'messages': [],
                    'target_agent_id': data.get('target_agent_id')
                }
            elif command == 'list_agents':
                # Mock agent list
                return {
                    'agents': [
                        {
                            'agent_id': agent_id,
                            'metadata': {
                                'display_name': agent_id,
                                'status': 'online'
                            },
                            'last_activity': time.time()
                        }
                    ]
                }
            else:
                return {}
                
        except Exception as e:
            logger.error(f"Error handling system command {command}: {e}")
            return {}
    
    async def _handle_thread_messaging_command(self, agent_id: str, command: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle thread messaging specific commands by converting to mod messages."""
        try:
            logger.info(f"🔧 _handle_thread_messaging_command: agent_id={agent_id}, command={command}, data={data}")
            
            if not hasattr(self.transport, 'network_instance') or not self.transport.network_instance:
                return {'success': False, 'error': 'Network instance not available'}
            
            network = self.transport.network_instance
            
            # Create appropriate mod message based on command
            if command == 'get_channel_messages':
                channel = data.get('channel', 'general')
                logger.info(f"🔧 Creating message retrieval for channel: {channel}")
                
                # Create a MessageRetrievalMessage
                mod_content = {
                    "message_type": "message_retrieval",
                    "sender_id": agent_id,
                    "action": "retrieve_channel_messages",
                    "channel": channel,
                    "limit": data.get('limit', 50),
                    "offset": data.get('offset', 0),
                    "include_threads": data.get('include_threads', True)
                }
            elif command == 'list_channels':
                # Create a ChannelInfoMessage
                mod_content = {
                    "message_type": "channel_info",
                    "sender_id": agent_id,
                    "action": "list_channels"
                }
            elif command == 'react_to_message':
                # Create a ReactionMessage
                mod_content = {
                    "message_type": "reaction",
                    "sender_id": agent_id,
                    "target_message_id": data.get('target_message_id'),
                    "reaction_type": data.get('reaction_type'),
                    "action": data.get('action', 'add')
                }
            elif command == 'send_channel_message':
                # Create a ChannelMessage with proper payload structure
                message_text = data.get('message', '')
                mod_content = {
                    "message_type": data.get('message_type', 'channel_message'),
                    "sender_id": agent_id,
                    "channel": data.get('channel', 'general'),
                    "text": message_text,  # For compatibility
                    "payload": {"text": message_text},  # The Event payload field
                    "timestamp": int(time.time())
                }
            else:
                return {'success': False, 'error': f'Unknown thread messaging command: {command}'}
            
            # Create Event
            from openagents.models.messages import Event, EventNames
            import uuid
            import asyncio
            
            # Generate unique request ID for response correlation
            request_id = str(uuid.uuid4())
            mod_content['request_id'] = request_id
            
            mod_message = Event(
                event_name="thread.request",
                source_id=agent_id,
                relevant_mod="openagents.mods.communication.thread_messaging",
                target_agent_id=agent_id,
                payload=mod_content,
                timestamp=int(time.time())
            )
            
            # Initialize pending requests dict if not exists
            if not hasattr(self, '_pending_requests'):
                self._pending_requests = {}
            
            # Create future to wait for response
            response_future = asyncio.Future()
            self._pending_requests[request_id] = response_future
            
            # Send through network's mod message handler
            await network._handle_mod_message(mod_message)
            
            # Wait for response with timeout
            try:
                response_data = await asyncio.wait_for(response_future, timeout=10.0)
                logger.info(f"🔧 Received mod response for {command}: {response_data}")
                return response_data
            except asyncio.TimeoutError:
                logger.warning(f"🔧 Timeout waiting for mod response to {command}")
                return {'success': False, 'error': 'Request timeout - mod did not respond'}
            finally:
                # Clean up pending request
                self._pending_requests.pop(request_id, None)
            
        except Exception as e:
            logger.error(f"Error handling thread messaging command: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _handle_shared_document_command(self, agent_id: str, command: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle shared document specific commands by converting to mod messages."""
        try:
            logger.info(f"🔧 _handle_shared_document_command: agent_id={agent_id}, command={command}, data={data}")
            
            if not hasattr(self.transport, 'network_instance') or not self.transport.network_instance:
                return {'success': False, 'error': 'Network instance not available'}
            
            network = self.transport.network_instance
            
            # Map command to appropriate event name for the refactored mod
            command_to_event = {
                'create_document': 'document.create',
                'list_documents': 'document.list',
                'open_document': 'document.open',
                'close_document': 'document.close',
                'insert_lines': 'document.insert_lines',
                'remove_lines': 'document.remove_lines',
                'replace_lines': 'document.replace_lines',
                'add_comment': 'document.add_comment',
                'remove_comment': 'document.remove_comment',
                'update_cursor_position': 'document.update_cursor',
                'acquire_line_lock': 'document.acquire_lock',
                'release_line_lock': 'document.release_lock',
                'get_document_content': 'document.get_content',
                'get_document_history': 'document.get_history',
                'get_agent_presence': 'document.get_presence'
            }
            
            event_name = command_to_event.get(command, f"document.{command}")
            
            # Create appropriate mod message based on command
            # The content should match exactly what the shared document mod expects
            mod_content = {
                "message_type": command,
                "sender_id": agent_id,  # Required by Event
                **data  # Include all data from the request (document_id, line_number, content, etc.)
            }
            
            # Create Event
            from openagents.models.messages import Event, EventNames
            import uuid
            
            mod_message = Event(
                event_name=event_name,
                source_id=agent_id,
                relevant_mod="openagents.mods.work.shared_document",
                target_agent_id=agent_id,
                payload=mod_content,
                timestamp=int(time.time())
            )
            
            # Send through network's mod message handler
            await network._handle_mod_message(mod_message)
            
            return {'success': True, 'forwarded_to_mod': True}
            
        except Exception as e:
            logger.error(f"Error handling shared document command: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _handle_check_mod_command(self, agent_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle mod checking commands to detect available mods."""
        try:
            mod_name = data.get('mod_name', '')
            logger.info(f"🔧 _handle_check_mod_command: agent_id={agent_id}, mod_name={mod_name}")
            
            if not hasattr(self.transport, 'network_instance') or not self.transport.network_instance:
                return {'success': False, 'error': 'Network instance not available'}
            
            network = self.transport.network_instance
            
            # Check if the mod is loaded in the network
            available_mods = getattr(network, 'mods', {})
            
            # Map frontend mod names to actual mod names
            mod_mapping = {
                'shared_documents': 'openagents.mods.work.shared_document',
                'thread_messaging': 'openagents.mods.communication.thread_messaging'
            }
            
            actual_mod_name = mod_mapping.get(mod_name, mod_name)
            is_available = actual_mod_name in available_mods
            
            logger.info(f"🔧 Mod check result: {mod_name} -> {actual_mod_name} = {is_available}")
            logger.info(f"🔧 Available mods: {list(available_mods.keys())}")
            
            return {
                'success': True,
                'response_data': {
                    'available': is_available,
                    'mod_name': mod_name,
                    'actual_mod_name': actual_mod_name
                }
            }
            
        except Exception as e:
            logger.error(f"Error handling check mod command: {e}")
            return {'success': False, 'error': str(e)}
    
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
    
    def queue_message_for_agent(self, agent_id: str, message: Dict[str, Any]):
        """Queue a message for an agent to retrieve via polling."""
        # Check if this is a response to a pending HTTP request
        if hasattr(self, '_pending_requests') and self._pending_requests:
            self._handle_mod_response(message)
        
        if agent_id in self.message_queues:
            self.message_queues[agent_id].append(message)
    
    def _handle_mod_response(self, message: Dict[str, Any]):
        """Handle responses from mods and resolve pending HTTP requests."""
        try:
            logger.info(f"🔧 _handle_mod_response called with message keys: {list(message.keys()) if isinstance(message, dict) else 'Not a dict'}")
            logger.info(f"🔧 Current pending requests: {list(self._pending_requests.keys()) if hasattr(self, '_pending_requests') else 'No _pending_requests'}")
            
            # Check if this message contains a request_id that matches a pending request
            request_id = message.get('request_id')
            logger.info(f"🔧 Found request_id in message: {request_id}")
            
            if request_id and hasattr(self, '_pending_requests') and request_id in self._pending_requests:
                future = self._pending_requests[request_id]
                if not future.done():
                    logger.info(f"🔧 Resolving pending request {request_id} with response")
                    future.set_result(message)
                    return True
                else:
                    logger.info(f"🔧 Future for request {request_id} is already done")
            else:
                logger.info(f"🔧 No matching pending request for {request_id}")
            
            # Also check in nested content/data structures
            content = message.get('content', {})
            if isinstance(content, dict):
                request_id = content.get('request_id')
                logger.info(f"🔧 Found request_id in nested content: {request_id}")
                if request_id and hasattr(self, '_pending_requests') and request_id in self._pending_requests:
                    future = self._pending_requests[request_id]
                    if not future.done():
                        logger.info(f"🔧 Resolving pending request {request_id} with nested response")
                        future.set_result(content)
                        return True
            
            # Also check in payload field (for Event responses)
            payload = message.get('payload', {})
            if isinstance(payload, dict):
                request_id = payload.get('request_id')
                logger.info(f"🔧 Found request_id in payload: {request_id}")
                if request_id and hasattr(self, '_pending_requests') and request_id in self._pending_requests:
                    future = self._pending_requests[request_id]
                    if not future.done():
                        logger.info(f"🔧 Resolving pending request {request_id} with payload response")
                        future.set_result(payload)
                        return True
            
            return False
        except Exception as e:
            logger.error(f"Error handling mod response: {e}")
            return False
    
    async def workspace_channels(self, request):
        """Handle workspace channels API requests."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            action = data.get('action', 'list_channels')
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error': 'agent_id is required'
                }, status=400)
            
            if action == 'list_channels':
                # Use the existing system command infrastructure
                result = await self._handle_system_command(agent_id, 'list_channels', {})
                
                if result.get('success'):
                    # Return channels in workspace format
                    channels = result.get('channels', [])
                    return web.json_response({
                        'success': True,
                        'channels': channels
                    })
                else:
                    # Return default channels
                    default_channels = [
                        {'name': 'general', 'description': 'General discussion', 'agents': [], 'message_count': 0, 'thread_count': 0},
                        {'name': 'development', 'description': 'Development discussions', 'agents': [], 'message_count': 0, 'thread_count': 0},
                        {'name': 'support', 'description': 'Support and help', 'agents': [], 'message_count': 0, 'thread_count': 0}
                    ]
                    return web.json_response({
                        'success': True,
                        'channels': default_channels
                    })
            
            return web.json_response({
                'success': False,
                'error': f'Unknown action: {action}'
            }, status=400)
            
        except Exception as e:
            logger.error(f"Error in workspace_channels: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def workspace_messages(self, request):
        """Handle workspace messages API requests."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            action = data.get('action', 'get_channel_messages')
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error': 'agent_id is required'
                }, status=400)
            
            if action == 'get_channel_messages':
                channel = data.get('channel', 'general')
                limit = data.get('limit', 50)
                offset = data.get('offset', 0)
                
                # Use the existing thread messaging command infrastructure
                result = await self._handle_thread_messaging_command(agent_id, 'get_channel_messages', {
                    'channel': channel,
                    'limit': limit,
                    'offset': offset,
                    'include_threads': data.get('include_threads', True)
                })
                
                if result.get('success') and result.get('messages'):
                    return web.json_response({
                        'success': True,
                        'messages': result['messages'],
                        'total_count': result.get('total_count', len(result['messages'])),
                        'has_more': result.get('has_more', False)
                    })
                else:
                    return web.json_response({
                        'success': True,
                        'messages': [],
                        'total_count': 0,
                        'has_more': False
                    })
            
            return web.json_response({
                'success': False,
                'error': f'Unknown action: {action}'
            }, status=400)
            
        except Exception as e:
            logger.error(f"Error in workspace_messages: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def workspace_agents(self, request):
        """Handle workspace agents API requests."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            action = data.get('action', 'list_agents')
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error': 'agent_id is required'
                }, status=400)
            
            if action == 'list_agents':
                # Use the existing system command infrastructure
                result = await self._handle_system_command(agent_id, 'list_agents', {})
                
                if result.get('success'):
                    agents = result.get('agents', [])
                    return web.json_response({
                        'success': True,
                        'agents': agents
                    })
                else:
                    return web.json_response({
                        'success': True,
                        'agents': []
                    })
            
            return web.json_response({
                'success': False,
                'error': f'Unknown action: {action}'
            }, status=400)
            
        except Exception as e:
            logger.error(f"Error in workspace_agents: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def workspace_react(self, request):
        """Handle workspace reaction API requests."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            action = data.get('action', 'react_to_message')
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error': 'agent_id is required'
                }, status=400)
            
            if action == 'react_to_message':
                target_message_id = data.get('target_message_id')
                reaction_type = data.get('reaction_type')
                
                if not target_message_id or not reaction_type:
                    return web.json_response({
                        'success': False,
                        'error': 'target_message_id and reaction_type are required'
                    }, status=400)
                
                # Use the existing thread messaging command infrastructure
                result = await self._handle_thread_messaging_command(agent_id, 'react_to_message', {
                    'target_message_id': target_message_id,
                    'reaction_type': reaction_type,
                    'action': 'add'
                })
                
                return web.json_response({
                    'success': result.get('success', True)
                })
            
            return web.json_response({
                'success': False,
                'error': f'Unknown action: {action}'
            }, status=400)
            
        except Exception as e:
            logger.error(f"Error in workspace_react: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def events_subscribe(self, request):
        """Handle event subscription requests."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            event_patterns = data.get('event_patterns', [])
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error': 'agent_id is required'
                }, status=400)
            
            # For now, just return a mock subscription ID
            # In a full implementation, this would integrate with the event system
            subscription_id = f"sub_{agent_id}_{int(time.time())}"
            
            logger.info(f"Event subscription created: {subscription_id} for agent {agent_id}")
            
            return web.json_response({
                'success': True,
                'subscription_id': subscription_id
            })
            
        except Exception as e:
            logger.error(f"Error in events_subscribe: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def events_unsubscribe(self, request):
        """Handle event unsubscription requests."""
        try:
            data = await request.json()
            subscription_id = data.get('subscription_id')
            
            if not subscription_id:
                return web.json_response({
                    'success': False,
                    'error': 'subscription_id is required'
                }, status=400)
            
            logger.info(f"Event subscription removed: {subscription_id}")
            
            return web.json_response({
                'success': True
            })
            
        except Exception as e:
            logger.error(f"Error in events_unsubscribe: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def start_server(self, host: str, port: int):
        """Start the HTTP server."""
        runner = web.AppRunner(self.app)
        await runner.setup()
        
        # Use a different port for HTTP (gRPC port + 1000)
        http_port = port + 1000
        site = web.TCPSite(runner, host, http_port)
        await site.start()
        
        logger.info(f"gRPC HTTP adapter listening on {host}:{http_port}")
        return runner
