"""
Agent-level wiki mod for OpenAgents.

This standalone mod provides wiki functionality with:
- Page creation and editing (owner-only direct edits)
- Proposal-based collaborative editing
- Version control and history
- Page search and discovery
"""

import logging
from typing import Dict, Any, List, Optional, Callable

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event
from openagents.models.event import EventVisibility
from openagents.models.tool import AgentTool
from .wiki_messages import (
    WikiPageCreateMessage,
    WikiPageEditMessage,
    WikiPageGetMessage,
    WikiPageSearchMessage,
    WikiPageListMessage,
    WikiPageEditProposalMessage,
    WikiEditProposalListMessage,
    WikiEditProposalResolveMessage,
    WikiPageHistoryMessage,
    WikiPageRevertMessage,
)

logger = logging.getLogger(__name__)

# Type definitions for handlers
WikiHandler = Callable[[Dict[str, Any], str], None]


class WikiAgentAdapter(BaseModAdapter):
    """Agent-level wiki mod implementation.

    This standalone mod provides:
    - Wiki page creation and editing
    - Proposal-based collaborative editing
    - Version control and page history
    - Page search and discovery
    """

    def __init__(self):
        """Initialize the wiki adapter for an agent."""
        super().__init__(mod_name="wiki")

        # Initialize adapter state
        self.wiki_handlers: Dict[str, WikiHandler] = {}
        self.pending_requests: Dict[str, Dict[str, Any]] = (
            {}
        )  # request_id -> request metadata
        self.completed_requests: Dict[str, Dict[str, Any]] = (
            {}
        )  # request_id -> response data

    def initialize(self) -> bool:
        """Initialize the wiki adapter.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        logger.info(f"Initializing Wiki adapter for agent {self.agent_id}")
        return True

    def shutdown(self) -> bool:
        """Shutdown the wiki adapter.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        logger.info(f"Shutting down Wiki adapter for agent {self.agent_id}")
        return True

    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process an incoming mod message.

        Args:
            message: The mod message to process
        """
        logger.debug(f"Received wiki message from {message.source_id}")

        # Handle different event types based on event name
        event_name = message.event_name

        if event_name == "wiki.page.create_response":
            await self._handle_page_create_response(message)
        elif event_name == "wiki.page.edit_response":
            await self._handle_page_edit_response(message)
        elif event_name == "wiki.page.get_response":
            await self._handle_page_get_response(message)
        elif event_name == "wiki.pages.search_response":
            await self._handle_pages_search_response(message)
        elif event_name == "wiki.pages.list_response":
            await self._handle_pages_list_response(message)
        elif event_name == "wiki.page.proposal.create_response":
            await self._handle_proposal_create_response(message)
        elif event_name == "wiki.proposals.list_response":
            await self._handle_proposals_list_response(message)
        elif event_name == "wiki.proposal.resolve_response":
            await self._handle_proposal_resolve_response(message)
        elif event_name == "wiki.page.history_response":
            await self._handle_page_history_response(message)
        elif event_name == "wiki.page.revert_response":
            await self._handle_page_revert_response(message)
        elif event_name == "wiki.page.notification":
            await self._handle_page_notification(message)
        elif event_name == "wiki.proposal.notification":
            await self._handle_proposal_notification(message)
        else:
            logger.debug(f"Unhandled wiki event: {event_name}")

    async def create_wiki_page(
        self, page_path: str, title: str, content: str
    ) -> Optional[str]:
        """Create a new wiki page.

        Args:
            page_path: Path/identifier for the wiki page
            title: Title of the wiki page
            content: Content of the wiki page in markdown

        Returns:
            Optional[str]: Page path if successful, None if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot create wiki page: connector is None for agent {self.agent_id}"
            )
            return None

        # Create page creation message
        create_msg = WikiPageCreateMessage(
            source_id=self.agent_id,
            page_path=page_path,
            title=title,
            wiki_content=content,
        )

        # Wrap in Event for proper transport
        wrapper_payload = create_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.page.create",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "create_page",
            "page_path": page_path,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent create wiki page request for {page_path}")

        # Wait for response
        return await self._wait_for_response(message.event_id, "page_path")

    async def edit_wiki_page(self, page_path: str, content: str) -> bool:
        """Edit an existing wiki page (owner only).

        Args:
            page_path: Path/identifier for the wiki page
            content: Updated content of the wiki page

        Returns:
            bool: True if successful, False if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot edit wiki page: connector is None for agent {self.agent_id}"
            )
            return False

        # Create page edit message
        edit_msg = WikiPageEditMessage(
            source_id=self.agent_id, page_path=page_path, wiki_content=content
        )

        # Wrap in Event for proper transport
        wrapper_payload = edit_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.page.edit",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "edit_page",
            "page_path": page_path,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent edit wiki page request for {page_path}")

        # Wait for response
        result = await self._wait_for_response(message.event_id, "success")
        return result if result is not None else False

    async def get_wiki_page(
        self, page_path: str, version: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a wiki page.

        Args:
            page_path: Path/identifier for the wiki page
            version: Specific version to retrieve (None for latest)

        Returns:
            Optional[Dict[str, Any]]: Page data if found, None if not found
        """
        if self.connector is None:
            logger.error(
                f"Cannot get wiki page: connector is None for agent {self.agent_id}"
            )
            return None

        # Create page get message
        get_msg = WikiPageGetMessage(
            source_id=self.agent_id, page_path=page_path, version=version
        )

        # Wrap in Event for proper transport
        wrapper_payload = get_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.page.get",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "get_page",
            "page_path": page_path,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent get wiki page request for {page_path}")

        # Wait for response
        return await self._wait_for_response(message.event_id, "page_data")

    async def search_wiki_pages(
        self, query: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search wiki pages.

        Args:
            query: Search query
            limit: Maximum number of results

        Returns:
            List[Dict[str, Any]]: List of matching pages
        """
        if self.connector is None:
            logger.error(
                f"Cannot search wiki pages: connector is None for agent {self.agent_id}"
            )
            return []

        # Create search message
        search_msg = WikiPageSearchMessage(
            source_id=self.agent_id, query=query, limit=limit
        )

        # Wrap in Event for proper transport
        wrapper_payload = search_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.pages.search",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "search_pages",
            "query": query,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent search wiki pages request for query: {query}")

        # Wait for response
        result = await self._wait_for_response(message.event_id, "pages")
        return result if result is not None else []

    async def list_wiki_pages(
        self, category: Optional[str] = None, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """List wiki pages.

        Args:
            category: Filter by category (None for all)
            limit: Maximum number of pages to return

        Returns:
            List[Dict[str, Any]]: List of pages
        """
        if self.connector is None:
            logger.error(
                f"Cannot list wiki pages: connector is None for agent {self.agent_id}"
            )
            return []

        # Create list message
        list_msg = WikiPageListMessage(
            source_id=self.agent_id, category=category, limit=limit
        )

        # Wrap in Event for proper transport
        wrapper_payload = list_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.pages.list",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "list_pages",
            "category": category,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent list wiki pages request")

        # Wait for response
        result = await self._wait_for_response(message.event_id, "pages")
        return result if result is not None else []

    async def propose_wiki_page_edit(
        self, page_path: str, content: str, rationale: str
    ) -> Optional[str]:
        """Propose an edit to a wiki page.

        Args:
            page_path: Path/identifier for the wiki page
            content: Proposed content for the wiki page
            rationale: Rationale for the proposed edit

        Returns:
            Optional[str]: Proposal ID if successful, None if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot propose wiki page edit: connector is None for agent {self.agent_id}"
            )
            return None

        # Create proposal message
        proposal_msg = WikiPageEditProposalMessage(
            source_id=self.agent_id,
            page_path=page_path,
            wiki_content=content,
            rationale=rationale,
        )

        # Wrap in Event for proper transport
        wrapper_payload = proposal_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.page.proposal.create",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "create_proposal",
            "page_path": page_path,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent propose wiki page edit request for {page_path}")

        # Wait for response
        return await self._wait_for_response(message.event_id, "proposal_id")

    async def list_wiki_edit_proposals(
        self, page_path: Optional[str] = None, status: str = "pending"
    ) -> List[Dict[str, Any]]:
        """List edit proposals.

        Args:
            page_path: Filter by specific page (None for all)
            status: Filter by proposal status

        Returns:
            List[Dict[str, Any]]: List of proposals
        """
        if self.connector is None:
            logger.error(
                f"Cannot list wiki edit proposals: connector is None for agent {self.agent_id}"
            )
            return []

        # Create list proposals message
        list_msg = WikiEditProposalListMessage(
            source_id=self.agent_id, page_path=page_path, status=status
        )

        # Wrap in Event for proper transport
        wrapper_payload = list_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.proposals.list",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "list_proposals",
            "page_path": page_path,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent list wiki edit proposals request")

        # Wait for response
        result = await self._wait_for_response(message.event_id, "proposals")
        return result if result is not None else []

    async def resolve_wiki_edit_proposal(
        self, proposal_id: str, action: str, comments: Optional[str] = None
    ) -> bool:
        """Resolve an edit proposal.

        Args:
            proposal_id: ID of the proposal to resolve
            action: Action to take ("approve" or "reject")
            comments: Optional comments

        Returns:
            bool: True if successful, False if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot resolve wiki edit proposal: connector is None for agent {self.agent_id}"
            )
            return False

        if action not in ["approve", "reject"]:
            logger.error(f"Invalid action: {action}. Must be 'approve' or 'reject'")
            return False

        # Create resolve message
        resolve_msg = WikiEditProposalResolveMessage(
            source_id=self.agent_id,
            proposal_id=proposal_id,
            action=action,
            comments=comments,
        )

        # Wrap in Event for proper transport
        wrapper_payload = resolve_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.proposal.resolve",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "resolve_proposal",
            "proposal_id": proposal_id,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent resolve wiki edit proposal request for {proposal_id}")

        # Wait for response
        result = await self._wait_for_response(message.event_id, "success")
        return result if result is not None else False

    async def get_wiki_page_history(
        self, page_path: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get wiki page history.

        Args:
            page_path: Path/identifier for the wiki page
            limit: Maximum number of versions to return

        Returns:
            List[Dict[str, Any]]: List of page versions
        """
        if self.connector is None:
            logger.error(
                f"Cannot get wiki page history: connector is None for agent {self.agent_id}"
            )
            return []

        # Create history message
        history_msg = WikiPageHistoryMessage(
            source_id=self.agent_id, page_path=page_path, limit=limit
        )

        # Wrap in Event for proper transport
        wrapper_payload = history_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.page.history",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "get_history",
            "page_path": page_path,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(f"Sent get wiki page history request for {page_path}")

        # Wait for response
        result = await self._wait_for_response(message.event_id, "versions")
        return result if result is not None else []

    async def revert_wiki_page_version(
        self, page_path: str, target_version: int
    ) -> bool:
        """Revert a wiki page to a previous version.

        Args:
            page_path: Path/identifier for the wiki page
            target_version: Version number to revert to

        Returns:
            bool: True if successful, False if failed
        """
        if self.connector is None:
            logger.error(
                f"Cannot revert wiki page: connector is None for agent {self.agent_id}"
            )
            return False

        # Create revert message
        revert_msg = WikiPageRevertMessage(
            source_id=self.agent_id, page_path=page_path, target_version=target_version
        )

        # Wrap in Event for proper transport
        wrapper_payload = revert_msg.model_dump()
        wrapper_payload["relevant_agent_id"] = self.agent_id
        message = Event(
            event_name="wiki.page.revert",
            source_id=self.agent_id,
            payload=wrapper_payload,
            relevant_mod="openagents.mods.workspace.wiki",
            visibility=EventVisibility.MOD_ONLY,
        )

        # Store pending request
        self.pending_requests[message.event_id] = {
            "action": "revert_page",
            "page_path": page_path,
            "timestamp": message.timestamp,
        }

        await self.connector.send_event(message)
        logger.debug(
            f"Sent revert wiki page request for {page_path} to version {target_version}"
        )

        # Wait for response
        result = await self._wait_for_response(message.event_id, "success")
        return result if result is not None else False

    def register_wiki_handler(self, handler_id: str, handler: WikiHandler) -> None:
        """Register a handler for wiki events.

        Args:
            handler_id: Unique identifier for the handler
            handler: Function to call when a wiki event is received
        """
        self.wiki_handlers[handler_id] = handler
        logger.debug(f"Registered wiki handler {handler_id}")

    def unregister_wiki_handler(self, handler_id: str) -> None:
        """Unregister a wiki handler.

        Args:
            handler_id: Identifier of the handler to unregister
        """
        if handler_id in self.wiki_handlers:
            del self.wiki_handlers[handler_id]
            logger.debug(f"Unregistered wiki handler {handler_id}")

    async def _wait_for_response(
        self, request_id: str, response_key: str, timeout: int = 10
    ):
        """Wait for a response to a request.

        Args:
            request_id: ID of the request
            response_key: Key to extract from response data
            timeout: Timeout in seconds

        Returns:
            Response data or None if timeout/error
        """
        import asyncio

        # Wait up to timeout seconds for the response
        for _ in range(timeout * 5):  # 5 checks per second
            if request_id in self.completed_requests:
                result = self.completed_requests.pop(request_id)
                if result.get("success"):
                    return result.get(response_key)
                else:
                    logger.error(
                        f"Request failed: {result.get('error', 'Unknown error')}"
                    )
                    return None

            await asyncio.sleep(0.2)

        # Timeout - clean up and return None
        logger.warning(f"Request timed out: {request_id}")
        if request_id in self.pending_requests:
            del self.pending_requests[request_id]
        return None

    async def _handle_page_create_response(self, message: Event) -> None:
        """Handle page create response."""
        await self._handle_generic_response(message, "create_page")

    async def _handle_page_edit_response(self, message: Event) -> None:
        """Handle page edit response."""
        await self._handle_generic_response(message, "edit_page")

    async def _handle_page_get_response(self, message: Event) -> None:
        """Handle page get response."""
        await self._handle_generic_response(message, "get_page")

    async def _handle_pages_search_response(self, message: Event) -> None:
        """Handle pages search response."""
        await self._handle_generic_response(message, "search_pages")

    async def _handle_pages_list_response(self, message: Event) -> None:
        """Handle pages list response."""
        await self._handle_generic_response(message, "list_pages")

    async def _handle_proposal_create_response(self, message: Event) -> None:
        """Handle proposal create response."""
        await self._handle_generic_response(message, "create_proposal")

    async def _handle_proposals_list_response(self, message: Event) -> None:
        """Handle proposals list response."""
        await self._handle_generic_response(message, "list_proposals")

    async def _handle_proposal_resolve_response(self, message: Event) -> None:
        """Handle proposal resolve response."""
        await self._handle_generic_response(message, "resolve_proposal")

    async def _handle_page_history_response(self, message: Event) -> None:
        """Handle page history response."""
        await self._handle_generic_response(message, "get_history")

    async def _handle_page_revert_response(self, message: Event) -> None:
        """Handle page revert response."""
        await self._handle_generic_response(message, "revert_page")

    async def _handle_generic_response(self, message: Event, action: str) -> None:
        """Handle a generic response message."""
        request_id = message.payload.get("request_id")

        if request_id and request_id in self.pending_requests:
            # Store completion result
            self.completed_requests[request_id] = message.payload

            # Clean up pending request
            del self.pending_requests[request_id]

            # Call registered handlers
            for handler in self.wiki_handlers.values():
                try:
                    handler(message.payload, message.source_id)
                except Exception as e:
                    logger.error(f"Error in wiki handler: {e}")

    async def _handle_page_notification(self, message: Event) -> None:
        """Handle page notification from the network."""
        logger.info(f"Received wiki page notification")

        # Forward to registered handlers
        for handler in self.wiki_handlers.values():
            try:
                handler(message.payload, message.source_id)
            except Exception as e:
                logger.error(f"Error in wiki handler: {e}")

    async def _handle_proposal_notification(self, message: Event) -> None:
        """Handle proposal notification from the network."""
        logger.info(f"Received wiki proposal notification")

        # Forward to registered handlers
        for handler in self.wiki_handlers.values():
            try:
                handler(message.payload, message.source_id)
            except Exception as e:
                logger.error(f"Error in wiki handler: {e}")

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the wiki adapter.

        Returns:
            List[AgentAdapterTool]: The wiki tools for the adapter
        """
        tools = []

        # Tool 1: Create wiki page
        create_page_tool = AgentTool(
            name="create_wiki_page",
            description="Create a new wiki page",
            input_schema={
                "type": "object",
                "properties": {
                    "page_path": {
                        "type": "string",
                        "description": "Path/identifier for the wiki page (e.g., 'ai/ethics' or 'guides/setup')",
                    },
                    "title": {
                        "type": "string",
                        "description": "Title of the wiki page",
                    },
                    "content": {
                        "type": "string",
                        "description": "Content of the wiki page in markdown format",
                    },
                },
                "required": ["page_path", "title", "content"],
            },
            func=self.create_wiki_page,
        )
        tools.append(create_page_tool)

        # Tool 2: Edit wiki page
        edit_page_tool = AgentTool(
            name="edit_wiki_page",
            description="Edit an existing wiki page (owner/creator only)",
            input_schema={
                "type": "object",
                "properties": {
                    "page_path": {
                        "type": "string",
                        "description": "Path/identifier for the wiki page",
                    },
                    "content": {
                        "type": "string",
                        "description": "Updated content of the wiki page in markdown format",
                    },
                },
                "required": ["page_path", "content"],
            },
            func=self.edit_wiki_page,
        )
        tools.append(edit_page_tool)

        # Tool 3: Get wiki page
        get_page_tool = AgentTool(
            name="get_wiki_page",
            description="Retrieve a wiki page",
            input_schema={
                "type": "object",
                "properties": {
                    "page_path": {
                        "type": "string",
                        "description": "Path/identifier for the wiki page",
                    },
                    "version": {
                        "type": "integer",
                        "description": "Specific version to retrieve (omit for latest version)",
                    },
                },
                "required": ["page_path"],
            },
            func=self.get_wiki_page,
        )
        tools.append(get_page_tool)

        # Tool 4: Search wiki pages
        search_pages_tool = AgentTool(
            name="search_wiki_pages",
            description="Search wiki pages by title and content",
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results (default 10)",
                        "default": 10,
                        "minimum": 1,
                        "maximum": 100,
                    },
                },
                "required": ["query"],
            },
            func=self.search_wiki_pages,
        )
        tools.append(search_pages_tool)

        # Tool 5: List wiki pages
        list_pages_tool = AgentTool(
            name="list_wiki_pages",
            description="List wiki pages with optional category filter",
            input_schema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Filter by category (omit for all categories)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of pages to return (default 50)",
                        "default": 50,
                        "minimum": 1,
                        "maximum": 200,
                    },
                },
                "required": [],
            },
            func=self.list_wiki_pages,
        )
        tools.append(list_pages_tool)

        # Tool 6: Propose wiki page edit
        propose_edit_tool = AgentTool(
            name="propose_wiki_page_edit",
            description="Propose an edit to a wiki page (for non-owners)",
            input_schema={
                "type": "object",
                "properties": {
                    "page_path": {
                        "type": "string",
                        "description": "Path/identifier for the wiki page",
                    },
                    "content": {
                        "type": "string",
                        "description": "Proposed content for the wiki page in markdown format",
                    },
                    "rationale": {
                        "type": "string",
                        "description": "Rationale for the proposed edit",
                    },
                },
                "required": ["page_path", "content", "rationale"],
            },
            func=self.propose_wiki_page_edit,
        )
        tools.append(propose_edit_tool)

        # Tool 7: List wiki edit proposals
        list_proposals_tool = AgentTool(
            name="list_wiki_edit_proposals",
            description="List edit proposals with optional filters",
            input_schema={
                "type": "object",
                "properties": {
                    "page_path": {
                        "type": "string",
                        "description": "Filter by specific page (omit for all pages)",
                    },
                    "status": {
                        "type": "string",
                        "description": "Filter by proposal status",
                        "enum": ["pending", "approved", "rejected", "superseded"],
                        "default": "pending",
                    },
                },
                "required": [],
            },
            func=self.list_wiki_edit_proposals,
        )
        tools.append(list_proposals_tool)

        # Tool 8: Resolve wiki edit proposal
        resolve_proposal_tool = AgentTool(
            name="resolve_wiki_edit_proposal",
            description="Resolve an edit proposal (page owner only)",
            input_schema={
                "type": "object",
                "properties": {
                    "proposal_id": {
                        "type": "string",
                        "description": "ID of the proposal to resolve",
                    },
                    "action": {
                        "type": "string",
                        "description": "Action to take",
                        "enum": ["approve", "reject"],
                    },
                    "comments": {
                        "type": "string",
                        "description": "Optional comments about the resolution",
                    },
                },
                "required": ["proposal_id", "action"],
            },
            func=self.resolve_wiki_edit_proposal,
        )
        tools.append(resolve_proposal_tool)

        # Tool 9: Get wiki page history
        get_history_tool = AgentTool(
            name="get_wiki_page_history",
            description="Get version history of a wiki page",
            input_schema={
                "type": "object",
                "properties": {
                    "page_path": {
                        "type": "string",
                        "description": "Path/identifier for the wiki page",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of versions to return (default 20)",
                        "default": 20,
                        "minimum": 1,
                        "maximum": 100,
                    },
                },
                "required": ["page_path"],
            },
            func=self.get_wiki_page_history,
        )
        tools.append(get_history_tool)

        # Tool 10: Revert wiki page version
        revert_page_tool = AgentTool(
            name="revert_wiki_page_version",
            description="Revert a wiki page to a previous version (owner only)",
            input_schema={
                "type": "object",
                "properties": {
                    "page_path": {
                        "type": "string",
                        "description": "Path/identifier for the wiki page",
                    },
                    "target_version": {
                        "type": "integer",
                        "description": "Version number to revert to",
                    },
                },
                "required": ["page_path", "target_version"],
            },
            func=self.revert_wiki_page_version,
        )
        tools.append(revert_page_tool)

        return tools
