"""
A2A (Agent2Agent) Transport Implementation for OpenAgents.

This module provides a full A2A transport that enables protocol-agnostic
agent communication. Agents connected via any transport (gRPC, WebSocket,
HTTP, A2A) can discover and communicate with each other.

Based on A2A Protocol Specification v0.3:
https://a2a-protocol.org/latest/specification/

Endpoints:
    GET  /.well-known/agent.json  - Agent Card discovery
    POST /                        - JSON-RPC methods
    GET  /                        - Info endpoint

Supported JSON-RPC Methods:
    Standard A2A:
    - message/send     - Send message, create/continue task
    - tasks/get        - Get task status
    - tasks/list       - List tasks
    - tasks/cancel     - Cancel a task

    OpenAgents Extensions (A2A-aligned):
    - agents/announce  - Remote agent announces its A2A endpoint
    - agents/withdraw  - Remote agent withdraws from network
    - agents/list      - List all agents (local + remote)
    - events/send      - Send an event through the network
"""

import asyncio
import logging
import os
import time
from typing import Dict, Any, Optional, List, TYPE_CHECKING

from aiohttp import web

from .base import Transport
from openagents.models.transport import TransportType, AgentConnection, RemoteAgentStatus
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.a2a import (
    AgentCard,
    AgentSkill,
    AgentCapabilities,
    AgentProvider,
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Artifact,
    TextPart,
    DataPart,
    Role,
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCError,
    A2AErrorCode,
    parse_parts,
    create_text_message,
)
from openagents.core.a2a_task_store import TaskStore, InMemoryTaskStore
from openagents.utils.a2a_converters import (
    A2ATaskEventNames,
    a2a_message_to_event,
    event_to_a2a_artifact,
    create_task_from_message,
    TASK_STATE_TO_EVENT,
)

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork
    from openagents.core.a2a_registry import A2AAgentRegistry

logger = logging.getLogger(__name__)


class A2ATransport(Transport):
    """
    A2A transport implementation using JSON-RPC 2.0 over HTTP.

    This transport exposes an OpenAgents network as an A2A-compliant
    server, allowing external A2A clients to interact with the network.

    Features:
        - Agent Card discovery at /.well-known/agent.json
        - Dynamic skill collection from registered agents
        - Task lifecycle management
        - JSON-RPC 2.0 protocol compliance

    Configuration:
        port: Port to listen on (default: 8900)
        host: Host to bind to (default: 0.0.0.0)
        agent:
            name: Agent name for the card
            version: Agent version
            description: Agent description
        auth:
            type: Authentication type (bearer, apiKey)
            token: Token value or env var name
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        network: Optional["AgentNetwork"] = None,
        a2a_registry: Optional["A2AAgentRegistry"] = None,
        task_store: Optional[TaskStore] = None,
    ):
        """Initialize A2A transport.

        Args:
            config: Transport configuration
            network: The network instance (for skill collection)
            a2a_registry: The A2A agent registry (for agent management)
            task_store: Optional custom task store (defaults to in-memory)
        """
        super().__init__(TransportType.A2A, config, is_notifiable=True)

        self._network = network
        self._a2a_registry = a2a_registry
        self.task_store = task_store or InMemoryTaskStore()

        # Configuration
        self.port = self.config.get("port", 8900)
        self.host = self.config.get("host", "0.0.0.0")

        # Agent card configuration
        self.agent_config = self.config.get("agent", {})

        # Authentication configuration
        self.auth_config = self.config.get("auth", {})

        # HTTP server components
        self.app = web.Application(middlewares=[self._cors_middleware])
        self.runner: Optional[web.AppRunner] = None
        self.site: Optional[web.TCPSite] = None

        # Setup routes
        self._setup_routes()

    def _setup_routes(self) -> None:
        """Setup HTTP routes for A2A protocol."""
        # Agent card discovery
        self.app.router.add_get(
            "/.well-known/agent.json", self._handle_agent_card
        )

        # JSON-RPC endpoint
        self.app.router.add_post("/", self._handle_jsonrpc)

        # CORS preflight
        self.app.router.add_options("/", self._handle_options)
        self.app.router.add_options(
            "/.well-known/agent.json", self._handle_options
        )

        # Info endpoint
        self.app.router.add_get("/", self._handle_info)

    @web.middleware
    async def _cors_middleware(
        self, request: web.Request, handler
    ) -> web.Response:
        """CORS middleware for browser compatibility."""
        if request.method == "OPTIONS":
            response = web.Response()
        else:
            response = await handler(request)

        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, OPTIONS"
        )
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, Accept"
        )
        response.headers["Access-Control-Max-Age"] = "86400"
        return response

    async def _handle_options(self, request: web.Request) -> web.Response:
        """Handle CORS preflight requests."""
        return web.Response()

    async def _handle_info(self, request: web.Request) -> web.Response:
        """Handle info endpoint."""
        return web.json_response({
            "name": self.agent_config.get("name", "OpenAgents A2A"),
            "protocol": "a2a",
            "protocolVersion": "0.3",
            "status": "running",
        })

    async def _handle_agent_card(
        self, request: web.Request
    ) -> web.Response:
        """Handle Agent Card discovery request."""
        # Emit discovery event
        await self._emit_event(
            A2ATaskEventNames.DISCOVERY_CARD_REQUESTED, {}
        )

        # Generate and return agent card
        card = self._generate_agent_card()
        return web.json_response(
            card.model_dump(by_alias=True, exclude_none=True)
        )

    def _collect_skills_from_agents(self) -> List[AgentSkill]:
        """Collect skills from all registered agents.

        Returns:
            List of AgentSkill objects from agent metadata
        """
        skills = []

        # Collect from agents via network's topology
        skills.extend(self._collect_skills_from_local_agents())

        # Collect from A2A agents via registry
        if self._a2a_registry:
            skills.extend(self._a2a_registry.get_all_skills())

        return skills

    def _collect_skills_from_local_agents(self) -> List[AgentSkill]:
        """Collect skills from agents connected via any transport.

        Returns:
            List of AgentSkill objects from agent metadata
        """
        skills = []

        if not self._network:
            return skills

        # Get agent registry from topology
        topology = getattr(self._network, "topology", None)
        if not topology:
            return skills

        agent_registry = getattr(topology, "agent_registry", {})

        for agent_id, agent_conn in agent_registry.items():
            # Skip A2A agents - their skills come from the registry
            if agent_conn.transport_type == TransportType.A2A:
                continue

            agent_metadata = getattr(agent_conn, "metadata", {}) or {}
            agent_skills = agent_metadata.get("skills", [])

            for skill in agent_skills:
                skill_id = skill.get("id", "default")
                skills.append(AgentSkill(
                    id=f"{agent_id}.{skill_id}",
                    name=skill.get("name", skill_id),
                    description=skill.get("description"),
                    input_modes=skill.get("input_modes", ["text"]),
                    output_modes=skill.get("output_modes", ["text"]),
                    tags=[agent_id] + skill.get("tags", []),
                    examples=skill.get("examples", []),
                ))

        return skills

    def _collect_skills_from_mods(self) -> List[AgentSkill]:
        """Collect skills from loaded mods (tools).

        Returns:
            List of AgentSkill objects from mod tools
        """
        skills = []

        if not self._network:
            return skills

        mods = getattr(self._network, "mods", {})

        for mod_id, mod in mods.items():
            # Try to get tools from mod
            get_tools = getattr(mod, "get_tools", None)
            if not callable(get_tools):
                continue

            try:
                mod_tools = get_tools()
                for tool in mod_tools:
                    tool_name = tool.get("name", "default")
                    skills.append(AgentSkill(
                        id=f"mod.{mod_id}.{tool_name}",
                        name=tool_name,
                        description=tool.get("description"),
                        input_modes=["text"],
                        output_modes=["text", "data"],
                        tags=["mod", mod_id],
                    ))
            except Exception as e:
                logger.warning(f"Failed to get tools from mod {mod_id}: {e}")

        return skills

    def _generate_agent_card(self) -> AgentCard:
        """Generate Agent Card with dynamically collected skills.

        Returns:
            AgentCard with current agent/mod skills
        """
        # Collect skills from agents and mods
        skills = []
        skills.extend(self._collect_skills_from_agents())
        skills.extend(self._collect_skills_from_mods())

        # Build provider info if configured
        provider = None
        provider_config = self.agent_config.get("provider")
        if provider_config:
            provider = AgentProvider(
                organization=provider_config.get("organization", "OpenAgents"),
                url=provider_config.get("url"),
            )

        # Determine URL
        url = self.agent_config.get(
            "url", f"http://{self.host}:{self.port}/"
        )

        return AgentCard(
            name=self.agent_config.get("name", "OpenAgents Network"),
            version=self.agent_config.get("version", "1.0.0"),
            description=self.agent_config.get(
                "description", "OpenAgents A2A Server"
            ),
            url=url,
            protocol_version="0.3",
            skills=skills,
            capabilities=AgentCapabilities(
                streaming=False,  # MVP: no streaming
                push_notifications=False,  # MVP: no push
                state_transition_history=False,
            ),
            provider=provider,
        )

    async def _handle_jsonrpc(self, request: web.Request) -> web.Response:
        """Handle JSON-RPC requests."""
        # Check authentication
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

        # Parse request
        try:
            body = await request.json()
            rpc_request = JSONRPCRequest(**body)
        except Exception as e:
            logger.warning(f"JSON-RPC parse error: {e}")
            return self._jsonrpc_error(
                None, A2AErrorCode.PARSE_ERROR, f"Parse error: {e}"
            )

        # Route to method handler
        method_handlers = {
            # Standard A2A methods
            "message/send": self._handle_send_message,
            "tasks/get": self._handle_get_task,
            "tasks/list": self._handle_list_tasks,
            "tasks/cancel": self._handle_cancel_task,
            # OpenAgents extensions (A2A-aligned)
            "agents/announce": self._handle_announce_agent,
            "agents/withdraw": self._handle_withdraw_agent,
            "agents/list": self._handle_list_agents,
            "events/send": self._handle_send_event,
            # Delegation methods (A2A-compatible task delegation)
            "delegation/delegate": self._handle_delegation_delegate,
            "delegation/accept": self._handle_delegation_accept,
            "delegation/reject": self._handle_delegation_reject,
            "delegation/report": self._handle_delegation_report,
            "delegation/complete": self._handle_delegation_complete,
            "delegation/fail": self._handle_delegation_fail,
            "delegation/cancel": self._handle_delegation_cancel,
            "delegation/get": self._handle_delegation_get,
            "delegation/list": self._handle_delegation_list,
        }

        handler = method_handlers.get(rpc_request.method)
        if not handler:
            return self._jsonrpc_error(
                rpc_request.id,
                A2AErrorCode.METHOD_NOT_FOUND,
                f"Method not found: {rpc_request.method}",
            )

        # Execute handler
        try:
            result = await handler(rpc_request.params or {})
            return self._jsonrpc_success(rpc_request.id, result)
        except ValueError as e:
            return self._jsonrpc_error(
                rpc_request.id,
                A2AErrorCode.INVALID_PARAMS,
                str(e),
            )
        except Exception as e:
            logger.exception(f"Error handling {rpc_request.method}")
            return self._jsonrpc_error(
                rpc_request.id,
                A2AErrorCode.INTERNAL_ERROR,
                str(e),
            )

    async def _handle_send_message(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle message/send method.

        Args:
            params: Request parameters containing message, contextId, taskId

        Returns:
            Task data as dictionary
        """
        # Extract parameters
        message_data = params.get("message", {})
        context_id = params.get("contextId")
        task_id = params.get("taskId")

        # Parse message
        parts = parse_parts(message_data.get("parts", []))
        if not parts:
            parts = [TextPart(text="")]

        message = A2AMessage(
            role=Role(message_data.get("role", "user")),
            parts=parts,
            metadata=message_data.get("metadata"),
        )

        # Get existing task or create new one
        if task_id:
            task = await self.task_store.get_task(task_id)
            if not task:
                raise ValueError(f"Task not found: {task_id}")

            # Add message to existing task
            await self.task_store.add_message(task_id, message)
            await self._emit_event(
                A2ATaskEventNames.CONTEXT_CONTINUED,
                {"task_id": task_id},
            )
        else:
            # Create new task
            task = create_task_from_message(message, context_id)
            await self.task_store.create_task(task)
            await self._emit_event(
                A2ATaskEventNames.CREATED,
                {"task_id": task.id, "context_id": task.context_id},
            )

        # Convert to Event and process through network
        event = a2a_message_to_event(
            message, task.id, task.context_id, source_id="a2a:external"
        )

        # Update task status to working
        await self.task_store.update_task_state(task.id, TaskState.WORKING)
        await self._emit_event(
            A2ATaskEventNames.WORKING,
            {"task_id": task.id},
        )

        # Process via event handler (connected to network)
        if self.event_handler:
            try:
                response = await self.event_handler(event)
                await self._process_event_response(task.id, response)
            except Exception as e:
                logger.error(f"Event handler error: {e}")
                await self.task_store.update_status(
                    task.id,
                    TaskStatus(
                        state=TaskState.FAILED,
                        message=create_text_message(
                            f"Processing error: {e}", Role.AGENT
                        ),
                    ),
                )
                await self._emit_event(
                    A2ATaskEventNames.FAILED,
                    {"task_id": task.id, "error": str(e)},
                )
        else:
            # No event handler - mark as completed with no artifacts
            await self.task_store.update_task_state(
                task.id, TaskState.COMPLETED
            )
            await self._emit_event(
                A2ATaskEventNames.COMPLETED,
                {"task_id": task.id},
            )

        # Return updated task
        task = await self.task_store.get_task(task.id)
        return task.model_dump(by_alias=True, exclude_none=True)

    async def _process_event_response(
        self, task_id: str, response: Optional[EventResponse]
    ) -> None:
        """Process an event response and update task accordingly.

        Args:
            task_id: The task ID to update
            response: The event response from the handler
        """
        if not response:
            await self.task_store.update_task_state(
                task_id, TaskState.COMPLETED
            )
            await self._emit_event(
                A2ATaskEventNames.COMPLETED,
                {"task_id": task_id},
            )
            return

        if response.success:
            # Create artifact from response data
            if response.data:
                # Extract text or use string representation
                if isinstance(response.data, dict):
                    text = response.data.get("text", str(response.data))
                else:
                    text = str(response.data)

                artifact = Artifact(
                    name="response",
                    parts=[TextPart(text=text)],
                )
                await self.task_store.add_artifact(task_id, artifact)
                await self._emit_event(
                    A2ATaskEventNames.ARTIFACT_ADDED,
                    {"task_id": task_id},
                )

            # Mark completed
            await self.task_store.update_task_state(
                task_id, TaskState.COMPLETED
            )
            await self._emit_event(
                A2ATaskEventNames.COMPLETED,
                {"task_id": task_id},
            )
        else:
            # Mark failed with error message
            await self.task_store.update_status(
                task_id,
                TaskStatus(
                    state=TaskState.FAILED,
                    message=create_text_message(
                        response.message or "Processing failed",
                        Role.AGENT,
                    ),
                ),
            )
            await self._emit_event(
                A2ATaskEventNames.FAILED,
                {"task_id": task_id, "error": response.message},
            )

    async def _handle_get_task(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle tasks/get method.

        Args:
            params: Request parameters containing task id

        Returns:
            Task data as dictionary
        """
        task_id = params.get("id")
        if not task_id:
            raise ValueError("Task ID is required")

        task = await self.task_store.get_task(task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")

        await self._emit_event(
            A2ATaskEventNames.GET,
            {"task_id": task_id},
        )

        # Apply history length limit if specified
        history_length = params.get("historyLength")
        if history_length is not None and history_length >= 0:
            task_dict = task.model_dump(by_alias=True, exclude_none=True)
            task_dict["history"] = task_dict.get("history", [])[-history_length:]
            return task_dict

        return task.model_dump(by_alias=True, exclude_none=True)

    async def _handle_list_tasks(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle tasks/list method.

        Args:
            params: Request parameters with optional filtering

        Returns:
            Dictionary containing list of tasks
        """
        context_id = params.get("contextId")
        limit = params.get("limit", 100)
        offset = params.get("offset", 0)

        tasks = await self.task_store.list_tasks(context_id, limit, offset)

        await self._emit_event(
            A2ATaskEventNames.LIST,
            {"count": len(tasks), "context_id": context_id},
        )

        return {
            "tasks": [
                t.model_dump(by_alias=True, exclude_none=True)
                for t in tasks
            ]
        }

    async def _handle_cancel_task(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle tasks/cancel method.

        Args:
            params: Request parameters containing task id

        Returns:
            Canceled task data as dictionary
        """
        task_id = params.get("id")
        if not task_id:
            raise ValueError("Task ID is required")

        task = await self.task_store.get_task(task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")

        # Check if task can be canceled
        terminal_states = [
            TaskState.COMPLETED,
            TaskState.FAILED,
            TaskState.CANCELED,
            TaskState.REJECTED,
        ]
        if task.status.state in terminal_states:
            raise ValueError(
                f"Task cannot be canceled in state: {task.status.state.value}"
            )

        # Update status to canceled
        await self.task_store.update_task_state(task_id, TaskState.CANCELED)

        await self._emit_event(
            A2ATaskEventNames.CANCELED,
            {"task_id": task_id},
        )

        task = await self.task_store.get_task(task_id)
        return task.model_dump(by_alias=True, exclude_none=True)

    # =========================================================================
    # OpenAgents Extension Methods - A2A-aligned Agent Management
    # =========================================================================

    async def _handle_announce_agent(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle agents/announce method - remote agent announces its endpoint.

        A2A-aligned way for external agents to join the network. The agent
        provides its A2A endpoint URL, and the network fetches its Agent Card
        to discover its capabilities.

        Args:
            params: Request parameters containing:
                - url: A2A endpoint URL (required)
                - agent_id: Preferred agent ID (optional, derived from URL if not provided)
                - metadata: Additional metadata (optional)

        Returns:
            Announcement result with assigned agent_id
        """
        url = params.get("url")
        if not url:
            raise ValueError("url is required")

        preferred_id = params.get("agent_id") or params.get("agentId")
        metadata = params.get("metadata", {})

        logger.info(f"A2A agent announcement: {url} (preferred_id={preferred_id})")

        # Use A2A registry for agent management
        if not self._a2a_registry:
            return {
                "success": False,
                "url": url,
                "error": "A2A registry not available",
            }

        try:
            connection = await self._a2a_registry.announce_agent(
                url=url,
                preferred_id=preferred_id,
                metadata=metadata,
            )

            logger.info(f"Announced agent {connection.agent_id} at {url}")

            return {
                "success": True,
                "agent_id": connection.agent_id,
                "url": connection.address,
                "message": "Agent announced successfully",
                "skills": [
                    {"id": s.id, "name": s.name}
                    for s in (connection.agent_card.skills if connection.agent_card else [])
                ],
            }

        except ConnectionError as e:
            logger.warning(f"Failed to announce agent at {url}: {e}")
            return {
                "success": False,
                "url": url,
                "error": str(e),
            }
        except Exception as e:
            logger.error(f"Agent announcement error: {e}")
            return {
                "success": False,
                "url": url,
                "error": str(e),
            }

    async def _handle_withdraw_agent(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle agents/withdraw method - remote agent leaves the network.

        Args:
            params: Request parameters containing:
                - agent_id: Agent ID to withdraw (required)

        Returns:
            Withdrawal result
        """
        agent_id = params.get("agent_id") or params.get("agentId")
        if not agent_id:
            raise ValueError("agent_id is required")

        logger.info(f"A2A agent withdrawal: {agent_id}")

        # Use A2A registry for agent management
        if not self._a2a_registry:
            return {
                "success": False,
                "agent_id": agent_id,
                "error": "A2A registry not available",
            }

        success = await self._a2a_registry.withdraw_agent(agent_id)

        if success:
            logger.info(f"Withdrawn agent {agent_id}")
            return {
                "success": True,
                "agent_id": agent_id,
                "message": "Agent withdrawn successfully",
            }
        else:
            return {
                "success": False,
                "agent_id": agent_id,
                "error": "Agent not found or not an A2A agent",
            }

    async def _handle_list_agents(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle agents/list method - list all agents in the network.

        Returns all agents registered in the network, grouped by transport type.

        Args:
            params: Request parameters containing:
                - transport: Optional filter by transport type
                - status: Optional filter by status (for A2A agents)

        Returns:
            List of agents with their info
        """
        transport_filter = params.get("transport")
        status_filter = params.get("status")

        agents = []

        # Get topology from network
        topology = getattr(self._network, "topology", None) if self._network else None

        if topology:
            agent_registry = getattr(topology, "agent_registry", {})

            for agent_id, conn in agent_registry.items():
                transport_type = conn.transport_type

                # Apply transport filter
                if transport_filter:
                    transport_str = (
                        transport_type.value if hasattr(transport_type, 'value')
                        else str(transport_type)
                    )
                    if transport_str != transport_filter:
                        continue

                # Apply status filter for A2A agents
                if status_filter and transport_type == TransportType.A2A:
                    if conn.remote_status:
                        status_str = (
                            conn.remote_status.value if hasattr(conn.remote_status, 'value')
                            else str(conn.remote_status)
                        )
                        if status_str != status_filter:
                            continue

                # Build agent info
                transport_str = (
                    transport_type.value if hasattr(transport_type, 'value')
                    else str(transport_type) if transport_type else "unknown"
                )

                agent_info = {
                    "agent_id": conn.agent_id,
                    "transport": transport_str,
                    "address": conn.address,
                    "last_seen": conn.last_seen,
                }

                # Add A2A-specific fields
                if transport_type == TransportType.A2A:
                    status_str = (
                        conn.remote_status.value if hasattr(conn.remote_status, 'value')
                        else str(conn.remote_status) if conn.remote_status else "unknown"
                    )
                    agent_info["status"] = status_str
                    agent_info["skills"] = [
                        {"id": s.id, "name": s.name}
                        for s in (conn.agent_card.skills if conn.agent_card else [])
                    ]
                    agent_info["announced_at"] = conn.announced_at
                else:
                    # For non-A2A agents, get skills from metadata
                    metadata = getattr(conn, "metadata", {}) or {}
                    agent_info["skills"] = metadata.get("skills", [])
                    agent_info["status"] = "active"

                agents.append(agent_info)

        # Count by transport
        transport_counts = {}
        for agent in agents:
            transport = agent.get("transport", "unknown")
            transport_counts[transport] = transport_counts.get(transport, 0) + 1

        return {
            "agents": agents,
            "total": len(agents),
            "by_transport": transport_counts,
        }

    async def _handle_registry_event(
        self, event_name: str, data: Dict[str, Any]
    ) -> None:
        """Handle events from the A2A agent registry.

        Args:
            event_name: The event name (e.g., agent.a2a.announced)
            data: Event data
        """
        await self._emit_event(event_name, data)

    async def _handle_send_event(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle events/send method - send an event through the network.

        This is the A2A equivalent of gRPC's SendEvent, allowing agents
        to send arbitrary events through the network.

        Args:
            params: Request parameters containing:
                - event_name: Name of the event (required)
                - source_id: Source agent ID (required)
                - destination_id: Target agent ID (optional)
                - payload: Event payload data (optional)
                - metadata: Event metadata (optional)

        Returns:
            Event response with success status and any response data
        """
        event_name = params.get("event_name") or params.get("eventName")
        source_id = params.get("source_id") or params.get("sourceId")

        if not event_name:
            raise ValueError("event_name is required")
        if not source_id:
            raise ValueError("source_id is required")

        destination_id = params.get("destination_id") or params.get("destinationId")
        payload = params.get("payload", {})
        metadata = params.get("metadata", {})
        visibility = params.get("visibility", "network")

        # Create the event
        event = Event(
            event_name=event_name,
            source_id=source_id,
            destination_id=destination_id,
            payload=payload,
            metadata=metadata,
            visibility=visibility,
            timestamp=int(time.time()),
        )

        logger.debug(f"A2A SendEvent: {event_name} from {source_id}")

        # Route through event handler
        if self.event_handler:
            try:
                response = await self.event_handler(event)
                return {
                    "success": response.success if response else True,
                    "message": response.message if response else "",
                    "data": response.data if response else None,
                    "event_name": event_name,
                }
            except Exception as e:
                logger.error(f"SendEvent error: {e}")
                return {
                    "success": False,
                    "message": str(e),
                    "event_name": event_name,
                }
        else:
            return {
                "success": True,
                "message": "Event processed (standalone mode)",
                "event_name": event_name,
            }

    def _check_auth(self, request: web.Request) -> Optional[web.Response]:
        """Check authentication if required.

        Args:
            request: The HTTP request

        Returns:
            Error response if auth fails, None if auth passes
        """
        auth_type = self.auth_config.get("type")
        if not auth_type:
            return None

        if auth_type == "bearer":
            # Get expected token from config or env
            token = self.auth_config.get("token")
            token_env = self.auth_config.get("token_env")

            if token_env:
                expected_token = os.environ.get(token_env)
            else:
                expected_token = token

            if not expected_token:
                return None  # No token configured, allow access

            # Check Authorization header
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return self._jsonrpc_error(
                    None,
                    A2AErrorCode.AUTH_REQUIRED,
                    "Bearer token required",
                )

            if auth_header[7:] != expected_token:
                return self._jsonrpc_error(
                    None,
                    A2AErrorCode.AUTH_REQUIRED,
                    "Invalid token",
                )

        return None

    async def _emit_event(
        self, event_name: str, data: Dict[str, Any]
    ) -> None:
        """Emit an internal event for tracking/logging.

        Args:
            event_name: The event name
            data: Event payload data
        """
        if not self.event_handler:
            return

        event = Event(
            event_name=event_name,
            source_id="a2a:transport",
            payload=data,
        )

        try:
            await self.event_handler(event)
        except Exception as e:
            logger.debug(f"Event emission ignored: {e}")

    def _jsonrpc_success(
        self, id: Any, result: Any
    ) -> web.Response:
        """Create a JSON-RPC success response.

        Args:
            id: Request ID
            result: Result data

        Returns:
            JSON response
        """
        return web.json_response({
            "jsonrpc": "2.0",
            "result": result,
            "id": id,
        })

    def _jsonrpc_error(
        self,
        id: Any,
        code: int,
        message: str,
        data: Any = None,
    ) -> web.Response:
        """Create a JSON-RPC error response.

        Args:
            id: Request ID
            code: Error code
            message: Error message
            data: Optional additional data

        Returns:
            JSON response with error
        """
        error: Dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            error["data"] = data

        return web.json_response({
            "jsonrpc": "2.0",
            "error": error,
            "id": id,
        })

    # === Transport Interface Implementation ===

    async def initialize(self) -> bool:
        """Initialize the transport and start listening.

        Returns:
            True if initialization succeeded
        """
        try:
            self.runner = web.AppRunner(self.app)
            await self.runner.setup()

            self.site = web.TCPSite(self.runner, self.host, self.port)
            await self.site.start()

            # Set up registry event callback
            if self._a2a_registry:
                self._a2a_registry.set_event_callback(self._handle_registry_event)

            self.is_initialized = True
            self.is_listening = True

            logger.info(
                f"A2A Transport listening on http://{self.host}:{self.port}"
            )
            await self._emit_event(
                "transport.a2a.started",
                {"host": self.host, "port": self.port},
            )

            return True
        except Exception as e:
            logger.error(f"Failed to initialize A2A transport: {e}")
            return False

    async def shutdown(self) -> bool:
        """Shutdown the transport.

        Returns:
            True if shutdown succeeded
        """
        try:
            if self.site:
                await self.site.stop()
                self.site = None

            if self.runner:
                await self.runner.cleanup()
                self.runner = None

            self.is_initialized = False
            self.is_listening = False

            await self._emit_event(
                "transport.a2a.stopped", {}
            )
            logger.info("A2A Transport stopped")

            return True
        except Exception as e:
            logger.error(f"Failed to shutdown A2A transport: {e}")
            return False

    async def listen(self, address: str) -> bool:
        """Start listening for connections.

        Note: Already done in initialize() for HTTP transport.

        Args:
            address: Not used for A2A transport

        Returns:
            True if listening
        """
        return self.is_listening

    # =========================================================================
    # Delegation Methods - A2A-compatible task delegation via JSON-RPC
    # =========================================================================

    async def _handle_delegation_delegate(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/delegate - external agent delegates task to local agent.

        Args:
            params: Request parameters containing:
                - assignee_id: Agent ID to assign the task to (required)
                - description: Task description (required)
                - payload: Task data/parameters (optional)
                - timeout_seconds: Timeout in seconds (optional, default 300)
                - context_id: Context ID for multi-turn (optional)

        Returns:
            A2A Task data as dictionary
        """
        assignee_id = params.get("assignee_id") or params.get("assigneeId")
        description = params.get("description")
        payload = params.get("payload", {})
        timeout_seconds = params.get("timeout_seconds", params.get("timeoutSeconds", 300))
        context_id = params.get("context_id") or params.get("contextId")
        delegator_id = params.get("delegator_id") or params.get("delegatorId", "a2a:external")

        if not assignee_id:
            raise ValueError("assignee_id is required")
        if not description:
            raise ValueError("description is required")

        # Create event and route through network
        event = Event(
            event_name="task.delegate",
            source_id=delegator_id,
            payload={
                "assignee_id": assignee_id,
                "description": description,
                "payload": payload,
                "timeout_seconds": timeout_seconds,
                "context_id": context_id,
            },
            metadata={
                "a2a_external_delegator": True,
                "context_id": context_id,
            },
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                task_id = response.data.get("task_id")
                if task_id:
                    task = await self.task_store.get_task(task_id)
                    if task:
                        return task.model_dump(by_alias=True, exclude_none=True)
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_accept(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/accept - assignee accepts a delegated task.

        Args:
            params: Request parameters containing task_id

        Returns:
            Updated A2A Task data
        """
        task_id = params.get("task_id") or params.get("id")
        acceptor_id = params.get("acceptor_id") or params.get("acceptorId", "a2a:external")

        if not task_id:
            raise ValueError("task_id is required")

        event = Event(
            event_name="task.accept",
            source_id=acceptor_id,
            payload={"task_id": task_id},
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                task = await self.task_store.get_task(task_id)
                if task:
                    return task.model_dump(by_alias=True, exclude_none=True)
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_reject(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/reject - assignee rejects a delegated task.

        Args:
            params: Request parameters containing task_id and optional reason

        Returns:
            Updated A2A Task data
        """
        task_id = params.get("task_id") or params.get("id")
        reason = params.get("reason", "Task rejected")
        rejector_id = params.get("rejector_id") or params.get("rejectorId", "a2a:external")

        if not task_id:
            raise ValueError("task_id is required")

        event = Event(
            event_name="task.reject",
            source_id=rejector_id,
            payload={
                "task_id": task_id,
                "reason": reason,
            },
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                task = await self.task_store.get_task(task_id)
                if task:
                    return task.model_dump(by_alias=True, exclude_none=True)
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_report(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/report - report progress on a task.

        Args:
            params: Request parameters containing task_id, message, and optional data

        Returns:
            Updated A2A Task data
        """
        task_id = params.get("task_id") or params.get("id")
        message = params.get("message", "")
        data = params.get("data", {})
        reporter_id = params.get("reporter_id") or params.get("reporterId", "a2a:external")

        if not task_id:
            raise ValueError("task_id is required")

        event = Event(
            event_name="task.report",
            source_id=reporter_id,
            payload={
                "task_id": task_id,
                "progress": {
                    "message": message,
                    "data": data,
                },
            },
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                task = await self.task_store.get_task(task_id)
                if task:
                    return task.model_dump(by_alias=True, exclude_none=True)
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_complete(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/complete - mark task as completed.

        Args:
            params: Request parameters containing task_id and optional result

        Returns:
            Updated A2A Task data
        """
        task_id = params.get("task_id") or params.get("id")
        result = params.get("result", {})
        completer_id = params.get("completer_id") or params.get("completerId", "a2a:external")

        if not task_id:
            raise ValueError("task_id is required")

        event = Event(
            event_name="task.complete",
            source_id=completer_id,
            payload={
                "task_id": task_id,
                "result": result,
            },
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                task = await self.task_store.get_task(task_id)
                if task:
                    return task.model_dump(by_alias=True, exclude_none=True)
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_fail(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/fail - mark task as failed.

        Args:
            params: Request parameters containing task_id and error message

        Returns:
            Updated A2A Task data
        """
        task_id = params.get("task_id") or params.get("id")
        error = params.get("error", "Unknown error")
        failer_id = params.get("failer_id") or params.get("failerId", "a2a:external")

        if not task_id:
            raise ValueError("task_id is required")

        event = Event(
            event_name="task.fail",
            source_id=failer_id,
            payload={
                "task_id": task_id,
                "error": error,
            },
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                task = await self.task_store.get_task(task_id)
                if task:
                    return task.model_dump(by_alias=True, exclude_none=True)
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_cancel(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/cancel - delegator cancels a task.

        Args:
            params: Request parameters containing task_id

        Returns:
            Updated A2A Task data
        """
        task_id = params.get("task_id") or params.get("id")
        canceler_id = params.get("canceler_id") or params.get("cancelerId", "a2a:external")

        if not task_id:
            raise ValueError("task_id is required")

        event = Event(
            event_name="task.cancel",
            source_id=canceler_id,
            payload={"task_id": task_id},
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                task = await self.task_store.get_task(task_id)
                if task:
                    return task.model_dump(by_alias=True, exclude_none=True)
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_get(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/get - get task with delegation metadata.

        Args:
            params: Request parameters containing task_id

        Returns:
            A2A Task data with delegation metadata
        """
        task_id = params.get("task_id") or params.get("id")
        requester_id = params.get("requester_id") or params.get("requesterId", "a2a:external")

        if not task_id:
            raise ValueError("task_id is required")

        event = Event(
            event_name="task.get",
            source_id=requester_id,
            payload={"task_id": task_id},
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                # Return full task data including a2a_task
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def _handle_delegation_list(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle delegation/list - list delegated tasks.

        Args:
            params: Request parameters containing:
                - role: "delegated_by_me" or "assigned_to_me"
                - status: Optional list of status filters
                - limit: Max tasks to return (default 20)
                - offset: Pagination offset (default 0)

        Returns:
            List of tasks with pagination info
        """
        role = params.get("role", "delegated_by_me")
        status = params.get("status", [])
        limit = params.get("limit", 20)
        offset = params.get("offset", 0)
        requester_id = params.get("requester_id") or params.get("requesterId", "a2a:external")

        event = Event(
            event_name="task.list",
            source_id=requester_id,
            payload={
                "filter": {
                    "role": role,
                    "status": status,
                },
                "limit": limit,
                "offset": offset,
            },
        )

        if self._network:
            response = await self._network.process_event(event)
            if response and response.success:
                return response.data
            elif response:
                raise ValueError(response.message)

        raise ValueError("Network not available")

    async def send(self, event: Event) -> bool:
        """Send an event.

        For A2A transport, this handles outbound notifications
        or task updates. MVP implementation just logs.

        Args:
            event: The event to send

        Returns:
            True if sent successfully
        """
        logger.debug(f"A2A transport send: {event.event_name}")
        return True

    async def peer_connect(self, peer_id: str, address: str) -> bool:
        """Connect to a peer.

        Not used for HTTP-based A2A server.

        Args:
            peer_id: Peer identifier
            address: Peer address

        Returns:
            True
        """
        return True

    async def peer_disconnect(self, peer_id: str) -> bool:
        """Disconnect from a peer.

        Not used for HTTP-based A2A server.

        Args:
            peer_id: Peer identifier

        Returns:
            True
        """
        return True

    def set_network(self, network: "AgentNetwork") -> None:
        """Set the network reference for skill collection.

        Args:
            network: The AgentNetwork instance
        """
        self._network = network

    def set_a2a_registry(self, registry: "A2AAgentRegistry") -> None:
        """Set the A2A registry reference.

        Args:
            registry: The A2AAgentRegistry instance
        """
        self._a2a_registry = registry


def create_a2a_transport(
    config: Optional[Dict[str, Any]] = None,
    **kwargs,
) -> A2ATransport:
    """Factory function to create an A2A transport.

    Args:
        config: Transport configuration
        **kwargs: Additional arguments passed to A2ATransport

    Returns:
        Configured A2ATransport instance
    """
    return A2ATransport(config=config, **kwargs)
