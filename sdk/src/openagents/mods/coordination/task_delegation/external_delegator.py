"""
External A2A delegation handler for Task Delegation mod.

This module provides the ExternalDelegator class for managing outbound
delegations to external A2A agents.
"""

import asyncio
import logging
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

from openagents.core.connectors.a2a_connector import A2ANetworkConnector
from openagents.models.a2a import (
    A2AMessage,
    DataPart,
    Role,
    Task,
    TaskState,
    TextPart,
)

from .a2a_delegation import (
    TERMINAL_STATES,
    extract_delegation_metadata,
    update_delegation_metadata,
)

if TYPE_CHECKING:
    from openagents.core.a2a_registry import A2AAgentRegistry

logger = logging.getLogger(__name__)


# Type alias for external task callbacks
ExternalTaskCallback = Callable[[Task, str], None]


class ExternalDelegator:
    """
    Manages outbound delegations to external A2A agents.

    This class handles:
    - Creating connectors to external A2A agents
    - Sending delegation requests via A2A protocol
    - Polling/monitoring external task status
    - Canceling external delegations

    Usage:
        ```python
        delegator = ExternalDelegator(a2a_registry)

        # Delegate to external agent
        external_task = await delegator.delegate_to_external(
            task=local_task,
            external_url="https://external-agent.example.com"
        )

        # Poll for status
        updated_task = await delegator.poll_external_task(
            task_id=external_task.id,
            external_url="https://external-agent.example.com"
        )
        ```
    """

    # Default polling interval (seconds)
    DEFAULT_POLL_INTERVAL = 5.0

    # Default timeout for waiting on external tasks (seconds)
    DEFAULT_WAIT_TIMEOUT = 300.0

    def __init__(
        self,
        a2a_registry: Optional["A2AAgentRegistry"] = None,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
    ):
        """Initialize the external delegator.

        Args:
            a2a_registry: Optional A2A registry for looking up agent URLs
            poll_interval: Default polling interval for external tasks
        """
        self._a2a_registry = a2a_registry
        self._poll_interval = poll_interval

        # Cache of connectors by URL
        self._connectors: Dict[str, A2ANetworkConnector] = {}

        # Mapping of local task ID -> (external URL, external task ID)
        self._external_task_mapping: Dict[str, tuple[str, str]] = {}

        # Active polling tasks
        self._polling_tasks: Dict[str, asyncio.Task] = {}

        # Callbacks for external task updates
        self._callbacks: List[ExternalTaskCallback] = []

    async def get_connector(self, external_url: str) -> A2ANetworkConnector:
        """Get or create a connector for an external A2A URL.

        Args:
            external_url: URL of the external A2A agent

        Returns:
            Connected A2ANetworkConnector

        Raises:
            ConnectionError: If unable to connect to the external agent
        """
        if external_url not in self._connectors:
            connector = A2ANetworkConnector(
                a2a_server_url=external_url,
                agent_id="delegation-client",
                poll_interval=self._poll_interval,
            )

            connected = await connector.connect_to_server()
            if not connected:
                raise ConnectionError(
                    f"Failed to connect to external A2A agent at {external_url}"
                )

            self._connectors[external_url] = connector
            logger.info(f"Connected to external A2A agent at {external_url}")

        return self._connectors[external_url]

    async def delegate_to_external(
        self,
        task: Task,
        external_url: str,
        wait_for_completion: bool = False,
        timeout: float = DEFAULT_WAIT_TIMEOUT,
    ) -> Optional[Task]:
        """Delegate a task to an external A2A agent.

        Args:
            task: The local A2A Task to delegate
            external_url: URL of the external A2A agent
            wait_for_completion: Whether to wait for task completion
            timeout: Timeout for waiting (if wait_for_completion is True)

        Returns:
            The external Task (may be in WORKING state if not waiting)

        Raises:
            ConnectionError: If unable to connect to the external agent
            ValueError: If task doesn't have required delegation metadata
        """
        # Extract delegation info from task
        delegation = extract_delegation_metadata(task)
        description = delegation.get("description", "")
        payload = delegation.get("payload", {})

        if not description:
            raise ValueError("Task must have a description in delegation metadata")

        logger.info(f"Delegating task {task.id} to external agent at {external_url}")

        try:
            connector = await self.get_connector(external_url)

            # Create A2A message for delegation
            parts = [
                TextPart(text=description),
                DataPart(
                    data={
                        "delegation": True,
                        "local_task_id": task.id,
                        "payload": payload,
                    }
                ),
            ]

            message = A2AMessage(
                role=Role.USER,
                parts=parts,
                metadata={
                    "delegation_task_id": task.id,
                    "delegation_source": "openagents",
                },
            )

            # Send to external agent
            external_task = await connector.send_a2a_message(
                message, context_id=task.context_id
            )

            if not external_task:
                logger.error(
                    f"Failed to create external task for {task.id} at {external_url}"
                )
                return None

            # Store the mapping
            self._external_task_mapping[task.id] = (external_url, external_task.id)
            logger.info(
                f"Created external task {external_task.id} for local task {task.id}"
            )

            if wait_for_completion:
                external_task = await connector.wait_for_completion(
                    external_task.id, timeout=timeout
                )

            return external_task

        except Exception as e:
            logger.error(f"Error delegating to external agent: {e}")
            raise

    async def poll_external_task(
        self,
        local_task_id: str,
    ) -> Optional[Task]:
        """Poll the status of an external task.

        Args:
            local_task_id: The local task ID (used to look up external mapping)

        Returns:
            Updated external Task if found, None otherwise
        """
        if local_task_id not in self._external_task_mapping:
            logger.warning(f"No external mapping found for task {local_task_id}")
            return None

        external_url, external_task_id = self._external_task_mapping[local_task_id]

        try:
            connector = await self.get_connector(external_url)
            external_task = await connector.get_task(external_task_id)

            if external_task:
                await self._notify_callbacks(external_task, "polled")

            return external_task

        except Exception as e:
            logger.error(f"Error polling external task: {e}")
            return None

    async def poll_external_task_by_url(
        self,
        external_url: str,
        external_task_id: str,
    ) -> Optional[Task]:
        """Poll an external task directly by URL and task ID.

        Args:
            external_url: URL of the external A2A agent
            external_task_id: ID of the external task

        Returns:
            Updated external Task if found, None otherwise
        """
        try:
            connector = await self.get_connector(external_url)
            return await connector.get_task(external_task_id)
        except Exception as e:
            logger.error(f"Error polling external task: {e}")
            return None

    async def cancel_external_task(
        self,
        local_task_id: str,
    ) -> bool:
        """Cancel an external task.

        Args:
            local_task_id: The local task ID (used to look up external mapping)

        Returns:
            True if cancellation succeeded
        """
        if local_task_id not in self._external_task_mapping:
            logger.warning(f"No external mapping found for task {local_task_id}")
            return False

        external_url, external_task_id = self._external_task_mapping[local_task_id]

        try:
            connector = await self.get_connector(external_url)
            canceled_task = await connector.cancel_task(external_task_id)

            if canceled_task:
                await self._notify_callbacks(canceled_task, "canceled")
                logger.info(f"Canceled external task {external_task_id}")
                return True

            return False

        except Exception as e:
            logger.error(f"Error canceling external task: {e}")
            return False

    async def start_background_polling(
        self,
        local_task_id: str,
        callback: Optional[ExternalTaskCallback] = None,
        poll_interval: Optional[float] = None,
    ) -> None:
        """Start background polling for an external task.

        Args:
            local_task_id: The local task ID to poll for
            callback: Optional callback for task updates
            poll_interval: Optional custom polling interval
        """
        if local_task_id in self._polling_tasks:
            logger.warning(f"Already polling for task {local_task_id}")
            return

        if local_task_id not in self._external_task_mapping:
            logger.warning(f"No external mapping found for task {local_task_id}")
            return

        interval = poll_interval or self._poll_interval

        async def poll_loop():
            while True:
                try:
                    task = await self.poll_external_task(local_task_id)

                    if task:
                        if callback:
                            try:
                                callback(task, "updated")
                            except Exception as e:
                                logger.warning(f"Callback error: {e}")

                        # Stop polling if task reached terminal state
                        if task.status.state in TERMINAL_STATES:
                            logger.info(
                                f"External task for {local_task_id} completed "
                                f"with state {task.status.state.value}"
                            )
                            break

                    await asyncio.sleep(interval)

                except asyncio.CancelledError:
                    logger.info(f"Polling canceled for task {local_task_id}")
                    break
                except Exception as e:
                    logger.error(f"Error in polling loop: {e}")
                    await asyncio.sleep(interval)

            # Clean up
            self._polling_tasks.pop(local_task_id, None)

        self._polling_tasks[local_task_id] = asyncio.create_task(poll_loop())
        logger.info(f"Started background polling for task {local_task_id}")

    async def stop_background_polling(self, local_task_id: str) -> None:
        """Stop background polling for a task.

        Args:
            local_task_id: The local task ID to stop polling for
        """
        if local_task_id in self._polling_tasks:
            self._polling_tasks[local_task_id].cancel()
            try:
                await self._polling_tasks[local_task_id]
            except asyncio.CancelledError:
                pass
            self._polling_tasks.pop(local_task_id, None)
            logger.info(f"Stopped background polling for task {local_task_id}")

    def register_callback(self, callback: ExternalTaskCallback) -> None:
        """Register a callback for external task updates.

        Args:
            callback: Function called with (task, update_type)
        """
        self._callbacks.append(callback)

    def unregister_callback(self, callback: ExternalTaskCallback) -> None:
        """Unregister a callback.

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
                callback(task, update_type)
            except Exception as e:
                logger.warning(f"Callback error: {e}")

    def get_external_mapping(
        self, local_task_id: str
    ) -> Optional[tuple[str, str]]:
        """Get the external URL and task ID for a local task.

        Args:
            local_task_id: The local task ID

        Returns:
            Tuple of (external_url, external_task_id) if mapping exists
        """
        return self._external_task_mapping.get(local_task_id)

    def has_external_mapping(self, local_task_id: str) -> bool:
        """Check if a local task has an external mapping.

        Args:
            local_task_id: The local task ID

        Returns:
            True if an external mapping exists
        """
        return local_task_id in self._external_task_mapping

    def is_external_assignee(self, assignee_id: str) -> bool:
        """Check if an assignee ID refers to an external A2A agent.

        Args:
            assignee_id: The assignee identifier

        Returns:
            True if the assignee is external (URL or starts with "a2a:")
        """
        if assignee_id.startswith("http://") or assignee_id.startswith("https://"):
            return True
        if assignee_id.startswith("a2a:"):
            return True
        return False

    def resolve_external_url(self, assignee_id: str) -> Optional[str]:
        """Resolve an assignee ID to an external A2A URL.

        Args:
            assignee_id: The assignee identifier

        Returns:
            External A2A URL if resolvable, None otherwise
        """
        # Direct URL
        if assignee_id.startswith("http://") or assignee_id.startswith("https://"):
            return assignee_id

        # A2A prefix
        if assignee_id.startswith("a2a:"):
            agent_id = assignee_id[4:]
            # Try to look up in A2A registry
            if self._a2a_registry:
                agent = self._a2a_registry.get_agent(agent_id)
                if agent:
                    return agent.address
            return None

        return None

    async def shutdown(self) -> None:
        """Shutdown the external delegator and clean up resources."""
        logger.info("Shutting down ExternalDelegator")

        # Cancel all polling tasks
        for task_id in list(self._polling_tasks.keys()):
            await self.stop_background_polling(task_id)

        # Disconnect all connectors
        for url, connector in list(self._connectors.items()):
            try:
                await connector.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting from {url}: {e}")

        self._connectors.clear()
        self._external_task_mapping.clear()
        self._callbacks.clear()

        logger.info("ExternalDelegator shutdown complete")
