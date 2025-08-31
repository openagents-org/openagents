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
                    'capabilities': capabilities
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
            
            return web.json_response({
                'success': True,
                'messages': messages
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
                from openagents.models.messages import ModMessage
                
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
                
                mod_message = ModMessage(
                    message_id=message_id,
                    sender_id=data.get('sender_id'),
                    mod="openagents.mods.communication.thread_messaging",
                    direction="outbound",
                    relevant_agent_id=data.get('sender_id'),
                    content=mod_content,
                    timestamp=int(time.time())
                )
                
                # Send through network's mod message handler
                await self.transport.network_instance._handle_mod_message(mod_message)
                
                return web.json_response({
                    'success': True,
                    'message_id': message_id
                })
            else:
                # Fallback to transport message if no network instance
                from openagents.models.transport import TransportMessage
                
                message = TransportMessage(
                    message_id=str(uuid.uuid4()),
                    sender_id=data.get('sender_id'),
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
                if command in ['get_channel_messages', 'list_channels', 'react_to_message']:
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
            else:
                return {'success': False, 'error': f'Unknown thread messaging command: {command}'}
            
            # Create ModMessage
            from openagents.models.messages import ModMessage
            import uuid
            
            mod_message = ModMessage(
                message_id=str(uuid.uuid4()),
                sender_id=agent_id,
                mod="openagents.mods.communication.thread_messaging",
                direction="outbound",
                relevant_agent_id=agent_id,
                content=mod_content,
                timestamp=int(time.time())
            )
            
            # Send through network's mod message handler
            await network._handle_mod_message(mod_message)
            
            return {'success': True, 'forwarded_to_mod': True}
            
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
            
            # Create appropriate mod message based on command
            # The content should match exactly what the shared document mod expects
            # BaseMessage requires sender_id, and we need all the data fields
            mod_content = {
                "message_type": command,
                "sender_id": agent_id,  # Required by BaseMessage
                **data  # Include all data from the request (document_id, line_number, content, etc.)
            }
            
            # Create ModMessage
            from openagents.models.messages import ModMessage
            import uuid
            
            mod_message = ModMessage(
                message_id=str(uuid.uuid4()),
                sender_id=agent_id,
                mod="openagents.mods.work.shared_document",
                direction="outbound",
                relevant_agent_id=agent_id,
                content=mod_content,
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
    
    def queue_message_for_agent(self, agent_id: str, message: Dict[str, Any]):
        """Queue a message for an agent to retrieve via polling."""
        if agent_id in self.message_queues:
            self.message_queues[agent_id].append(message)
    
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
