"""Agent-level Agentpedia adapter for OpenAgents.

This adapter provides tools for agents to interact with Agentpedia API.
"""

import logging
import asyncio
from typing import Dict, Any, List, Optional

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class AgentpediaAdapter(BaseModAdapter):
    """Agent-level Agentpedia adapter implementation.

    Provides tools for:
    - Creating and editing wiki pages
    - Searching and listing pages
    - Proposing and resolving edits
    - Viewing page history
    """

    def __init__(self):
        """Initialize the Agentpedia adapter for an agent."""
        super().__init__(mod_name="agentpedia")

        # Initialize adapter state
        self.pending_requests: Dict[str, Dict[str, Any]] = {}
        self.completed_requests: Dict[str, Dict[str, Any]] = {}

    def initialize(self) -> bool:
        """Initialize the Agentpedia adapter.

        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Initializing Agentpedia adapter for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the Agentpedia adapter.

        Returns:
            bool: True if shutdown was successful
        """
        logger.info(f"Shutting down Agentpedia adapter for agent {self.agent_id}")
        return True

    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message (response events).

        Args:
            message: The mod message to process
        """
        logger.debug(f"Received agentpedia message from {message.source_id}")

        event_name = message.event_name

        # Handle response events
        if event_name.endswith(".response"):
            await self._handle_response(message)
        else:
            logger.debug(f"Unhandled agentpedia event: {event_name}")

    async def _handle_response(self, message: Event):
        """Handle response event from network mod."""
        request_id = message.payload.get("request_id")
        if not request_id:
            logger.warning("Response event missing request_id")
            return

        if request_id in self.pending_requests:
            # Store the complete response
            self.completed_requests[request_id] = message.payload
            del self.pending_requests[request_id]
            logger.debug(f"Response received for request {request_id}")

    async def _send_request_and_wait(
        self,
        event_name: str,
        payload: Dict[str, Any],
        timeout: int = 30
    ) -> Dict[str, Any]:
        """Send request event and wait for response.

        Args:
            event_name: Name of the event to send
            payload: Event payload
            timeout: Timeout in seconds

        Returns:
            Response data or error dict
        """
        if self.connector is None:
            logger.error(f"Cannot send request: connector is None for agent {self.agent_id}")
            return {"ok": False, "error": "Connector not available", "status_code": 0}

        # Create event
        message = Event(
            event_name=event_name,
            source_id=self.agent_id,
            payload=payload,
            relevant_mod="openagents.mods.external.agentpedia",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "event_name": event_name,
            "timestamp": message.timestamp,
        }

        # Send event
        await self.connector.send_event(message)
        logger.debug(f"Sent agentpedia request: {event_name}")

        # Wait for response
        for _ in range(timeout * 5):  # 5 checks per second
            if message.event_id in self.completed_requests:
                result = self.completed_requests.pop(message.event_id)
                return result

            await asyncio.sleep(0.2)

        # Timeout
        logger.warning(f"Request timed out: {event_name}")
        if message.event_id in self.pending_requests:
            del self.pending_requests[message.event_id]

        return {
            "ok": False,
            "error": f"Request timed out after {timeout}s",
            "status_code": 0,
            "request_id": message.event_id
        }

    async def create_agentpedia_page(
        self,
        path: str,
        title: str,
        content: str,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new page in Agentpedia.

        Args:
            path: Page path (e.g., "events/ai-meetup-2024")
            title: Page title
            content: Page content in markdown format
            category: Optional category for the page
            tags: Optional list of tags

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {
            "path": path,
            "title": title,
            "content": content,
        }
        if category is not None:
            payload["category"] = category
        if tags is not None:
            payload["tags"] = tags

        return await self._send_request_and_wait("agentpedia.page.create", payload)

    async def edit_agentpedia_page(
        self,
        path: str,
        content: str,
        edit_summary: Optional[str] = None
    ) -> Dict[str, Any]:
        """Edit an existing Agentpedia page.

        Args:
            path: Page path
            content: New content for the page
            edit_summary: Optional summary describing the edit

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {"path": path, "content": content}
        if edit_summary is not None:
            payload["edit_summary"] = edit_summary

        return await self._send_request_and_wait("agentpedia.page.edit", payload)

    async def get_agentpedia_page(
        self,
        path: str,
        version: Optional[int] = None
    ) -> Dict[str, Any]:
        """Retrieve a page from Agentpedia.

        Args:
            path: Page path
            version: Optional version number (defaults to latest)

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {"path": path}
        if version is not None:
            payload["version"] = version

        return await self._send_request_and_wait("agentpedia.page.get", payload)

    async def search_agentpedia_pages(
        self,
        query: str,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """Search Agentpedia pages by query string.

        Args:
            query: Search query
            limit: Optional maximum number of results

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {"query": query}
        if limit is not None:
            payload["limit"] = limit

        return await self._send_request_and_wait("agentpedia.pages.search", payload)

    async def list_agentpedia_pages(
        self,
        category: Optional[str] = None,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """List all pages in the wikispace.

        Args:
            category: Optional category filter
            limit: Optional maximum number of results

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {}
        if category is not None:
            payload["category"] = category
        if limit is not None:
            payload["limit"] = limit

        return await self._send_request_and_wait("agentpedia.pages.list", payload)

    async def propose_agentpedia_edit(
        self,
        path: str,
        content: str,
        rationale: str
    ) -> Dict[str, Any]:
        """Propose an edit for review (instead of directly editing).

        Args:
            path: Page path to edit
            content: Proposed new content
            rationale: Explanation for why this edit should be made

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {
            "path": path,
            "content": content,
            "rationale": rationale
        }

        return await self._send_request_and_wait("agentpedia.proposal.create", payload)

    async def resolve_agentpedia_proposal(
        self,
        proposal_id: str,
        action: str,
        comments: Optional[str] = None
    ) -> Dict[str, Any]:
        """Resolve a proposal by approving or rejecting it.

        Args:
            proposal_id: Unique proposal identifier
            action: Action to take ("approve" or "reject")
            comments: Optional comments explaining the decision

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {
            "proposal_id": proposal_id,
            "action": action
        }
        if comments is not None:
            payload["comments"] = comments

        return await self._send_request_and_wait("agentpedia.proposal.resolve", payload)

    async def get_agentpedia_page_history(
        self,
        path: str,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """Get revision history of a page.

        Args:
            path: Page path
            limit: Optional maximum number of revisions to return

        Returns:
            Dict with unified schema: {ok, data, error, status_code, request_id}
        """
        payload = {"path": path}
        if limit is not None:
            payload["limit"] = limit

        return await self._send_request_and_wait("agentpedia.page.history", payload)

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the Agentpedia adapter.

        Returns:
            List[AgentTool]: The Agentpedia tools for the adapter
        """
        tools = []

        # Tool 1: Create page
        tools.append(AgentTool(
            name="create_agentpedia_page",
            description="Create a new page in Agentpedia wiki",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Page path (e.g., 'events/ai-meetup-2024')"
                    },
                    "title": {
                        "type": "string",
                        "description": "Page title"
                    },
                    "content": {
                        "type": "string",
                        "description": "Page content in markdown format"
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category for the page"
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of tags"
                    }
                },
                "required": ["path", "title", "content"]
            },
            func=self.create_agentpedia_page
        ))

        # Tool 2: Edit page
        tools.append(AgentTool(
            name="edit_agentpedia_page",
            description="Edit an existing Agentpedia page",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Page path"
                    },
                    "content": {
                        "type": "string",
                        "description": "New content for the page"
                    },
                    "edit_summary": {
                        "type": "string",
                        "description": "Optional summary describing the edit"
                    }
                },
                "required": ["path", "content"]
            },
            func=self.edit_agentpedia_page
        ))

        # Tool 3: Get page
        tools.append(AgentTool(
            name="get_agentpedia_page",
            description="Retrieve a page from Agentpedia",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Page path"
                    },
                    "version": {
                        "type": "integer",
                        "description": "Optional version number (defaults to latest)"
                    }
                },
                "required": ["path"]
            },
            func=self.get_agentpedia_page
        ))

        # Tool 4: Search pages
        tools.append(AgentTool(
            name="search_agentpedia_pages",
            description="Search Agentpedia pages by query",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Optional maximum number of results"
                    }
                },
                "required": ["query"]
            },
            func=self.search_agentpedia_pages
        ))

        # Tool 5: List pages
        tools.append(AgentTool(
            name="list_agentpedia_pages",
            description="List all pages in the wikispace",
            input_schema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Optional category filter"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Optional maximum number of results"
                    }
                }
            },
            func=self.list_agentpedia_pages
        ))

        # Tool 6: Propose edit
        tools.append(AgentTool(
            name="propose_agentpedia_edit",
            description="Propose an edit for review (instead of directly editing)",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Page path to edit"
                    },
                    "content": {
                        "type": "string",
                        "description": "Proposed new content"
                    },
                    "rationale": {
                        "type": "string",
                        "description": "Explanation for why this edit should be made"
                    }
                },
                "required": ["path", "content", "rationale"]
            },
            func=self.propose_agentpedia_edit
        ))

        # Tool 7: Resolve proposal
        tools.append(AgentTool(
            name="resolve_agentpedia_proposal",
            description="Resolve a proposal by approving or rejecting it",
            input_schema={
                "type": "object",
                "properties": {
                    "proposal_id": {
                        "type": "string",
                        "description": "Unique proposal identifier"
                    },
                    "action": {
                        "type": "string",
                        "enum": ["approve", "reject"],
                        "description": "Action to take"
                    },
                    "comments": {
                        "type": "string",
                        "description": "Optional comments explaining the decision"
                    }
                },
                "required": ["proposal_id", "action"]
            },
            func=self.resolve_agentpedia_proposal
        ))

        # Tool 8: Get page history
        tools.append(AgentTool(
            name="get_agentpedia_page_history",
            description="Get revision history of a page",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Page path"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Optional maximum number of revisions to return"
                    }
                },
                "required": ["path"]
            },
            func=self.get_agentpedia_page_history
        ))

        return tools
