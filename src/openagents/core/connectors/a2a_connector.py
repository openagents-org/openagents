"""
A2A Network Connector for OpenAgents.

This module provides a connector for OpenAgents agents to communicate
with external A2A-compliant servers.

Features:
    - Agent card discovery
    - Send messages and create tasks
    - Poll for task status and artifacts
    - Task lifecycle management
    - Push notification support (webhook receiver)
"""

import asyncio
import logging
from typing import Dict, Any, Optional, List, Callable, Awaitable
from urllib.parse import urlparse

import aiohttp

from .base import NetworkConnector
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.a2a import (
    AgentCard,
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Artifact,
    TextPart,
    DataPart,
    Role,
    Part,
    PushNotificationConfig,
    parse_parts,
)
from openagents.utils.a2a_converters import (
    A2ATaskEventNames,
    event_to_a2a_message,
)

logger = logging.getLogger(__name__)


# Type alias for task update callbacks
TaskCallback = Callable[[Task, str], Awaitable[None]]


class A2ANetworkConnector(NetworkConnector):
    """
    Connector for communicating with external A2A agents.

    This connector allows OpenAgents agents to act as A2A clients,
    sending messages to and receiving responses from external A2A servers.

    Features:
        - Fetch agent cards (discovery)
        - Send messages and create tasks
        - Poll for task status and artifacts
        - Wait for task completion
        - Push notification webhook support

    Example:
        ```python
        connector = A2ANetworkConnector(
            a2a_server_url="https://remote-agent.example.com",
            agent_id="my-local-agent"
        )

        await connector.connect_to_server()
        print(f"Connected to: {connector.agent_card.name}")

        task = await connector.send_message("Hello!")
        completed_task = await connector.wait_for_completion(task.id)
        print(f"Response: {completed_task.artifacts}")
        ```
    """

    def __init__(
        self,
        a2a_server_url: str,
        agent_id: str,
        metadata: Optional[Dict[str, Any]] = None,
        auth_token: Optional[str] = None,
        poll_interval: float = 2.0,
        timeout: float = 30.0,
    ):
        """Initialize A2A Network Connector.

        Args:
            a2a_server_url: URL of the remote A2A server
            agent_id: Local agent identifier
            metadata: Optional agent metadata
            auth_token: Optional bearer token for authentication
            poll_interval: Interval for polling task status (seconds)
            timeout: HTTP request timeout (seconds)
        """
        # Parse URL to extract host/port for base class
        parsed = urlparse(a2a_server_url)

        super().__init__(
            host=parsed.hostname or "localhost",
            port=parsed.port or (443 if parsed.scheme == "https" else 80),
            agent_id=agent_id,
            metadata=metadata,
        )

        # A2A-specific configuration
        self.server_url = a2a_server_url.rstrip("/")
        self.auth_token = auth_token
        self.poll_interval = poll_interval
        self.timeout = aiohttp.ClientTimeout(total=timeout)

        # HTTP session
        self._session: Optional[aiohttp.ClientSession] = None

        # Cached agent card
        self._agent_card: Optional[AgentCard] = None

        # Active tasks being tracked
        self._active_tasks: Dict[str, Task] = {}

        # Background polling tasks
        self._polling_tasks: Dict[str, asyncio.Task] = {}

        # Task update callbacks
        self._callbacks: List[TaskCallback] = []

        # Push notification configuration
        self._push_config: Optional[PushNotificationConfig] = None

        # Enable polling mode
        self.is_polling = True

    async def connect_to_server(self) -> bool:
        """Connect to the A2A server and fetch agent card.

        Returns:
            True if connection and discovery succeeded
        """
        try:
            # Create HTTP session
            self._session = aiohttp.ClientSession(timeout=self.timeout)

            # Fetch agent card to verify connectivity
            self._agent_card = await self.fetch_agent_card()

            if self._agent_card:
                self.is_connected = True
                logger.info(
                    f"Connected to A2A agent: {self._agent_card.name} "
                    f"at {self.server_url}"
                )
                return True
            else:
                logger.error("Failed to fetch agent card")
                return False

        except Exception as e:
            logger.error(f"Failed to connect to A2A server: {e}")
            await self._close_session()
            return False

    async def disconnect(self) -> bool:
        """Disconnect from the A2A server.

        Returns:
            True if disconnection succeeded
        """
        try:
            # Cancel all polling tasks
            for task_id, polling_task in list(self._polling_tasks.items()):
                polling_task.cancel()
                try:
                    await polling_task
                except asyncio.CancelledError:
                    pass
            self._polling_tasks.clear()

            # Clear active tasks
            self._active_tasks.clear()

            # Close HTTP session
            await self._close_session()

            self.is_connected = False
            logger.info(f"Disconnected from A2A server: {self.server_url}")
            return True

        except Exception as e:
            logger.error(f"Failed to disconnect: {e}")
            return False

    async def _close_session(self) -> None:
        """Close the HTTP session."""
        if self._session:
            await self._session.close()
            self._session = None

    async def fetch_agent_card(self) -> Optional[AgentCard]:
        """Fetch the agent card from the server.

        Returns:
            AgentCard if successful, None otherwise
        """
        if not self._session:
            logger.error("Not connected - no HTTP session")
            return None

        try:
            url = f"{self.server_url}/.well-known/agent.json"
            async with self._session.get(
                url, headers=self._get_headers()
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return AgentCard(**data)
                else:
                    text = await resp.text()
                    logger.error(
                        f"Failed to fetch agent card: {resp.status} - {text}"
                    )
                    return None
        except Exception as e:
            logger.error(f"Error fetching agent card: {e}")
            return None

    async def send_message(
        self,
        text: str,
        context_id: Optional[str] = None,
        task_id: Optional[str] = None,
        parts: Optional[List[Dict[str, Any]]] = None,
        role: str = "user",
    ) -> Optional[Task]:
        """Send a message to the A2A agent.

        Args:
            text: Text content of the message
            context_id: Optional context ID for multi-turn conversations
            task_id: Optional task ID to continue an existing task
            parts: Optional list of parts (overrides text if provided)
            role: Message role (user or agent)

        Returns:
            Created/updated Task if successful, None otherwise
        """
        if parts is None:
            parts = [{"type": "text", "text": text}]

        params: Dict[str, Any] = {
            "message": {
                "role": role,
                "parts": parts,
            }
        }

        if context_id:
            params["contextId"] = context_id
        if task_id:
            params["taskId"] = task_id

        result = await self._jsonrpc_call("message/send", params)

        if result:
            task = Task(**result)
            self._active_tasks[task.id] = task
            await self._notify_callbacks(task, "created")
            return task

        return None

    async def send_a2a_message(
        self,
        message: A2AMessage,
        context_id: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> Optional[Task]:
        """Send an A2AMessage to the agent.

        Args:
            message: The A2A message to send
            context_id: Optional context ID
            task_id: Optional task ID to continue

        Returns:
            Created/updated Task if successful, None otherwise
        """
        parts = [
            p.model_dump(by_alias=True, exclude_none=True)
            for p in message.parts
        ]

        params: Dict[str, Any] = {
            "message": {
                "role": message.role.value,
                "parts": parts,
                "metadata": message.metadata,
            }
        }

        if context_id:
            params["contextId"] = context_id
        if task_id:
            params["taskId"] = task_id

        result = await self._jsonrpc_call("message/send", params)

        if result:
            task = Task(**result)
            self._active_tasks[task.id] = task
            await self._notify_callbacks(task, "created")
            return task

        return None

    async def get_task(self, task_id: str) -> Optional[Task]:
        """Get task status from the server.

        Args:
            task_id: The task ID to fetch

        Returns:
            Task if found, None otherwise
        """
        result = await self._jsonrpc_call("tasks/get", {"id": task_id})

        if result:
            task = Task(**result)
            old_task = self._active_tasks.get(task_id)
            self._active_tasks[task_id] = task

            # Check for state change
            if old_task and old_task.status.state != task.status.state:
                await self._notify_callbacks(task, "status_changed")

            return task

        return None

    async def list_tasks(
        self,
        context_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Task]:
        """List tasks from the server.

        Args:
            context_id: Optional context ID to filter by
            limit: Maximum number of tasks
            offset: Number of tasks to skip

        Returns:
            List of tasks
        """
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        if context_id:
            params["contextId"] = context_id

        result = await self._jsonrpc_call("tasks/list", params)

        if result and "tasks" in result:
            return [Task(**t) for t in result["tasks"]]

        return []

    async def cancel_task(self, task_id: str) -> Optional[Task]:
        """Cancel a task.

        Args:
            task_id: The task ID to cancel

        Returns:
            Canceled task if successful, None otherwise
        """
        result = await self._jsonrpc_call("tasks/cancel", {"id": task_id})

        if result:
            task = Task(**result)
            self._active_tasks[task_id] = task
            await self._notify_callbacks(task, "canceled")
            return task

        return None

    async def wait_for_completion(
        self,
        task_id: str,
        timeout: float = 60.0,
        poll_interval: Optional[float] = None,
    ) -> Optional[Task]:
        """Wait for a task to complete.

        Args:
            task_id: The task ID to wait for
            timeout: Maximum time to wait (seconds)
            poll_interval: Polling interval (defaults to connector's interval)

        Returns:
            Completed task, or latest task state if timeout
        """
        interval = poll_interval or self.poll_interval
        elapsed = 0.0

        terminal_states = [
            TaskState.COMPLETED,
            TaskState.FAILED,
            TaskState.CANCELED,
            TaskState.REJECTED,
        ]

        while elapsed < timeout:
            task = await self.get_task(task_id)

            if task and task.status.state in terminal_states:
                return task

            await asyncio.sleep(interval)
            elapsed += interval

        logger.warning(f"Task {task_id} timed out after {timeout}s")
        return await self.get_task(task_id)

    async def send_and_wait(
        self,
        text: str,
        timeout: float = 60.0,
        context_id: Optional[str] = None,
    ) -> Optional[Task]:
        """Send a message and wait for completion.

        Convenience method combining send_message and wait_for_completion.

        Args:
            text: Text content to send
            timeout: Maximum time to wait
            context_id: Optional context ID

        Returns:
            Completed task if successful, None otherwise
        """
        task = await self.send_message(text, context_id=context_id)
        if not task:
            return None

        return await self.wait_for_completion(task.id, timeout=timeout)

    def register_callback(self, callback: TaskCallback) -> None:
        """Register a callback for task updates.

        Args:
            callback: Async function called with (task, update_type)
        """
        self._callbacks.append(callback)

    def unregister_callback(self, callback: TaskCallback) -> None:
        """Unregister a task update callback.

        Args:
            callback: The callback to remove
        """
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    async def _notify_callbacks(self, task: Task, update_type: str) -> None:
        """Notify all registered callbacks.

        Args:
            task: The updated task
            update_type: Type of update
        """
        for callback in self._callbacks:
            try:
                await callback(task, update_type)
            except Exception as e:
                logger.warning(f"Callback error: {e}")

    async def send_event(self, event: Event) -> EventResponse:
        """Send an OpenAgents event as an A2A message.

        Implements the NetworkConnector interface.

        Args:
            event: The event to send

        Returns:
            EventResponse with result
        """
        # Convert event to A2A message
        message = event_to_a2a_message(event)

        # Extract context/task IDs from event metadata
        context_id = event.metadata.get("a2a_context_id")
        task_id = event.metadata.get("a2a_task_id")

        # Send message
        task = await self.send_a2a_message(
            message,
            context_id=context_id,
            task_id=task_id,
        )

        if task:
            return EventResponse(
                success=True,
                message="Message sent",
                data={
                    "task_id": task.id,
                    "status": task.status.state.value,
                },
            )

        return EventResponse(success=False, message="Failed to send message")

    async def poll_messages(self) -> List[Event]:
        """Poll for updates on active tasks.

        Implements the NetworkConnector interface.

        Returns:
            List of events for task updates
        """
        events = []

        for task_id in list(self._active_tasks.keys()):
            old_task = self._active_tasks.get(task_id)
            new_task = await self.get_task(task_id)

            if not new_task or not old_task:
                continue

            # Check for state change
            if new_task.status.state != old_task.status.state:
                events.append(Event(
                    event_name=A2ATaskEventNames.STATUS_UPDATED,
                    source_id=f"a2a:{self.server_url}",
                    payload={
                        "task_id": task_id,
                        "old_state": old_task.status.state.value,
                        "new_state": new_task.status.state.value,
                    },
                    metadata={"a2a_task_id": task_id},
                ))

            # Check for new artifacts
            old_artifact_count = len(old_task.artifacts)
            new_artifact_count = len(new_task.artifacts)

            if new_artifact_count > old_artifact_count:
                for artifact in new_task.artifacts[old_artifact_count:]:
                    events.append(Event(
                        event_name=A2ATaskEventNames.ARTIFACT_ADDED,
                        source_id=f"a2a:{self.server_url}",
                        payload={
                            "task_id": task_id,
                            "artifact": artifact.model_dump(
                                by_alias=True, exclude_none=True
                            ),
                        },
                        metadata={"a2a_task_id": task_id},
                    ))

        return events

    async def start_background_polling(
        self,
        task_id: str,
        callback: Optional[TaskCallback] = None,
    ) -> None:
        """Start background polling for a task.

        Args:
            task_id: The task ID to poll
            callback: Optional callback for updates
        """
        if task_id in self._polling_tasks:
            return  # Already polling

        async def poll_loop():
            terminal_states = [
                TaskState.COMPLETED,
                TaskState.FAILED,
                TaskState.CANCELED,
                TaskState.REJECTED,
            ]

            while True:
                try:
                    task = await self.get_task(task_id)
                    if task:
                        if callback:
                            await callback(task, "poll")

                        if task.status.state in terminal_states:
                            break

                    await asyncio.sleep(self.poll_interval)
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.warning(f"Polling error for {task_id}: {e}")
                    await asyncio.sleep(self.poll_interval)

            # Cleanup
            self._polling_tasks.pop(task_id, None)

        self._polling_tasks[task_id] = asyncio.create_task(poll_loop())

    async def stop_background_polling(self, task_id: str) -> None:
        """Stop background polling for a task.

        Args:
            task_id: The task ID to stop polling
        """
        polling_task = self._polling_tasks.pop(task_id, None)
        if polling_task:
            polling_task.cancel()
            try:
                await polling_task
            except asyncio.CancelledError:
                pass

    async def _jsonrpc_call(
        self,
        method: str,
        params: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Make a JSON-RPC call to the server.

        Args:
            method: JSON-RPC method name
            params: Method parameters

        Returns:
            Result data if successful, None otherwise
        """
        if not self._session:
            logger.error("Not connected - no HTTP session")
            return None

        try:
            payload = {
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
                "id": 1,
            }

            async with self._session.post(
                self.server_url,
                json=payload,
                headers=self._get_headers(),
            ) as resp:
                data = await resp.json()

                if "error" in data and data["error"]:
                    error = data["error"]
                    logger.error(
                        f"JSON-RPC error: [{error.get('code')}] "
                        f"{error.get('message')}"
                    )
                    return None

                return data.get("result")

        except aiohttp.ClientError as e:
            logger.error(f"HTTP error in JSON-RPC call: {e}")
            return None
        except Exception as e:
            logger.error(f"JSON-RPC call failed: {e}")
            return None

    def _get_headers(self) -> Dict[str, str]:
        """Get request headers including authentication.

        Returns:
            Headers dictionary
        """
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

        return headers

    @property
    def agent_card(self) -> Optional[AgentCard]:
        """Get the cached agent card.

        Returns:
            The remote agent's AgentCard, or None if not connected
        """
        return self._agent_card

    @property
    def active_task_count(self) -> int:
        """Get the number of active tasks being tracked.

        Returns:
            Number of active tasks
        """
        return len(self._active_tasks)

    def get_active_task(self, task_id: str) -> Optional[Task]:
        """Get an active task from the local cache.

        Args:
            task_id: The task ID to look up

        Returns:
            Cached task if found, None otherwise
        """
        return self._active_tasks.get(task_id)

    def clear_active_tasks(self) -> None:
        """Clear all tracked active tasks."""
        self._active_tasks.clear()
