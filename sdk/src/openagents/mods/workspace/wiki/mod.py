"""
Network-level wiki mod for OpenAgents.

This standalone mod enables collaborative wiki functionality with:
- Page creation and editing with ownership model
- Proposal-based collaborative editing
- Version control and history tracking
- Page search and discovery
"""

import logging
import json
import os
import time
import uuid
from typing import Dict, Any, List, Optional, Set
from pathlib import Path

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
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
    WikiPage,
    WikiPageVersion,
    WikiEditProposal,
)

logger = logging.getLogger(__name__)


class WikiNetworkMod(BaseMod):
    """Network-level wiki mod implementation.

    This standalone mod enables:
    - Collaborative wiki page creation and editing
    - Ownership-based direct editing
    - Proposal-based collaborative editing
    - Version control and history tracking
    - Page search and discovery
    """

    def __init__(self, mod_name: str = "wiki"):
        """Initialize the wiki mod for a network."""
        super().__init__(mod_name=mod_name)

        # Initialize mod state
        self.active_agents: Set[str] = set()

        logger.info(f"Initializing Wiki network mod")

    @property
    def pages(self) -> Dict[str, WikiPage]:
        """Get all pages (loaded from storage)."""
        # TODO: either add cache or implement get_pages method
        pages = {}
        try:
            storage_path = self.get_storage_path()
            pages_dir = storage_path / "pages"
            if pages_dir.exists():
                for page_file in pages_dir.glob("*.json"):
                    try:
                        page_path = page_file.stem.replace(
                            "_SLASH_", "/"
                        )  # Decode path from filename
                        with open(page_file, "r") as f:
                            page_dict = json.load(f)

                        page = WikiPage(
                            page_path=page_dict["page_path"],
                            title=page_dict["title"],
                            content=page_dict["content"],
                            created_by=page_dict["created_by"],
                            created_timestamp=page_dict["created_timestamp"],
                            current_version=page_dict.get("current_version", 1),
                        )
                        pages[page_path] = page
                    except Exception as e:
                        logger.error(f"Failed to load page from file {page_file}: {e}")
                        continue
        except Exception as e:
            logger.error(f"Failed to load wiki pages: {e}")
        return pages

    @property
    def page_versions(self) -> Dict[str, List[WikiPageVersion]]:
        """Get all page versions (loaded from storage)."""
        page_versions = {}
        try:
            storage_path = self.get_storage_path()
            versions_dir = storage_path / "versions"
            if versions_dir.exists():
                for version_file in versions_dir.glob("*.json"):
                    try:
                        page_path = version_file.stem.replace(
                            "_SLASH_", "/"
                        )  # Decode path from filename
                        with open(version_file, "r") as f:
                            versions_list = json.load(f)

                        versions = []
                        for version_dict in versions_list:
                            version = WikiPageVersion(
                                version_id=version_dict["version_id"],
                                page_path=version_dict["page_path"],
                                version_number=version_dict["version_number"],
                                content=version_dict["content"],
                                edited_by=version_dict["edited_by"],
                                edit_timestamp=version_dict["edit_timestamp"],
                                edit_type=version_dict.get("edit_type", "direct"),
                                parent_version=version_dict.get("parent_version"),
                            )
                            versions.append(version)
                        page_versions[page_path] = versions
                    except Exception as e:
                        logger.error(
                            f"Failed to load versions from file {version_file}: {e}"
                        )
                        continue
        except Exception as e:
            logger.error(f"Failed to load page versions: {e}")
        return page_versions

    @property
    def proposals(self) -> Dict[str, WikiEditProposal]:
        """Get all proposals (loaded from storage)."""
        proposals = {}
        try:
            storage_path = self.get_storage_path()
            proposals_dir = storage_path / "proposals"
            if proposals_dir.exists():
                for proposal_file in proposals_dir.glob("*.json"):
                    try:
                        proposal_id = proposal_file.stem  # filename without extension
                        with open(proposal_file, "r") as f:
                            proposal_dict = json.load(f)

                        proposal = WikiEditProposal(
                            proposal_id=proposal_dict["proposal_id"],
                            page_path=proposal_dict["page_path"],
                            proposed_content=proposal_dict["proposed_content"],
                            rationale=proposal_dict.get("rationale", ""),
                            proposed_by=proposal_dict["proposed_by"],
                            created_timestamp=proposal_dict["created_timestamp"],
                            status=proposal_dict.get("status", "pending"),
                            resolved_by=proposal_dict.get("resolved_by"),
                            resolved_timestamp=proposal_dict.get("resolved_timestamp"),
                            resolution_comments=proposal_dict.get(
                                "resolution_comments"
                            ),
                        )
                        proposals[proposal_id] = proposal
                    except Exception as e:
                        logger.error(
                            f"Failed to load proposal from file {proposal_file}: {e}"
                        )
                        continue
        except Exception as e:
            logger.error(f"Failed to load proposals: {e}")
        return proposals

    @property
    def page_proposals(self) -> Dict[str, List[str]]:
        """Get page-proposal mappings (loaded from metadata)."""
        try:
            storage_path = self.get_storage_path()
            metadata_file = storage_path / "metadata.json"

            if metadata_file.exists():
                with open(metadata_file, "r") as f:
                    metadata = json.load(f)
                return metadata.get("page_proposals", {})
            else:
                return {}
        except Exception as e:
            logger.error(f"Failed to load page proposals metadata: {e}")
            return {}

    def initialize(self) -> bool:
        """Initialize the mod and load persistent data.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        try:
            # No need to load all data - storage-first approach
            # Initialize default wiki threads
            self._initialize_wiki_threads()

            logger.info("Wiki mod initialization complete (storage-first mode)")
            return True
        except Exception as e:
            logger.error(f"Wiki mod initialization failed: {e}")
            return False

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully and save data.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        try:
            # Clear state (data is already in storage)
            self.active_agents.clear()

            logger.info("Wiki mod shutdown complete")
            return True
        except Exception as e:
            logger.error(f"Wiki mod shutdown failed: {e}")
            return False

    def bind_network(self, network):
        """Bind the mod to a network and initialize threads."""
        super().bind_network(network)
        # Initialize wiki threads after network is available
        self._initialize_wiki_threads()

    def _initialize_wiki_threads(self) -> None:
        """Initialize wiki-specific message threads."""
        if not self.network:
            return

        # Create global wiki threads
        wiki_threads = ["wiki_announcements", "wiki_new_pages", "wiki_recent_changes"]

        for thread_name in wiki_threads:
            self.network.event_gateway.create_channel(thread_name)
            logger.debug(f"Created wiki thread: {thread_name}")

    # Old _load_wiki_data method removed - now using storage-first approach with properties

    def get_page(self, page_path: str) -> Optional[WikiPage]:
        """Get a single page by path (loads only that page from storage)."""
        try:
            storage_path = self.get_storage_path()
            pages_dir = storage_path / "pages"
            filename = self._encode_page_path_for_filename(page_path) + ".json"
            page_file = pages_dir / filename

            if not page_file.exists():
                return None

            with open(page_file, "r") as f:
                page_dict = json.load(f)

            return WikiPage(
                page_path=page_dict["page_path"],
                title=page_dict["title"],
                content=page_dict["content"],
                created_by=page_dict["created_by"],
                created_timestamp=page_dict["created_timestamp"],
                current_version=page_dict.get("current_version", 1),
                category=page_dict.get("category"),
                is_locked=page_dict.get("is_locked", False),
                protection_level=page_dict.get("protection_level", "none"),
                tags=page_dict.get("tags", []),
            )
        except Exception as e:
            logger.error(f"Failed to load page {page_path}: {e}")
            return None

    def get_page_versions(self, page_path: str) -> List[WikiPageVersion]:
        """Get versions for a specific page (loads only that page's versions from storage)."""
        try:
            storage_path = self.get_storage_path()
            versions_dir = storage_path / "versions"
            filename = self._encode_page_path_for_filename(page_path) + ".json"
            version_file = versions_dir / filename

            if not version_file.exists():
                return []

            with open(version_file, "r") as f:
                versions_list = json.load(f)

            versions = []
            for version_dict in versions_list:
                version = WikiPageVersion(
                    version_id=version_dict["version_id"],
                    page_path=version_dict["page_path"],
                    version_number=version_dict["version_number"],
                    content=version_dict["content"],
                    edited_by=version_dict["edited_by"],
                    edit_timestamp=version_dict["edit_timestamp"],
                    edit_type=version_dict.get("edit_type", "direct"),
                    parent_version=version_dict.get("parent_version"),
                )
                versions.append(version)
            return versions
        except Exception as e:
            logger.error(f"Failed to load versions for page {page_path}: {e}")
            return []

    def get_proposal(self, proposal_id: str) -> Optional[WikiEditProposal]:
        """Get a specific proposal by ID (loads only that proposal from storage)."""
        try:
            storage_path = self.get_storage_path()
            proposals_dir = storage_path / "proposals"
            proposal_file = proposals_dir / f"{proposal_id}.json"

            if not proposal_file.exists():
                return None

            with open(proposal_file, "r") as f:
                proposal_dict = json.load(f)

            return WikiEditProposal(
                proposal_id=proposal_dict["proposal_id"],
                page_path=proposal_dict["page_path"],
                proposed_content=proposal_dict["proposed_content"],
                rationale=proposal_dict.get("rationale", ""),
                proposed_by=proposal_dict["proposed_by"],
                created_timestamp=proposal_dict["created_timestamp"],
                status=proposal_dict.get("status", "pending"),
                resolved_by=proposal_dict.get("resolved_by"),
                resolved_timestamp=proposal_dict.get("resolved_timestamp"),
                resolution_comments=proposal_dict.get("resolution_comments"),
            )
        except Exception as e:
            logger.error(f"Failed to load proposal {proposal_id}: {e}")
            return None

    def _encode_page_path_for_filename(self, page_path: str) -> str:
        """Encode page path to be safe for filename."""
        return page_path.replace("/", "_SLASH_")

    def _save_page(self, page: WikiPage):
        """Save a single page to its own file."""
        try:
            storage_path = self.get_storage_path()
            pages_dir = storage_path / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)

            filename = self._encode_page_path_for_filename(page.page_path) + ".json"
            page_file = pages_dir / filename

            page_data = (
                page.model_dump() if hasattr(page, "model_dump") else page.dict()
            )

            with open(page_file, "w") as f:
                json.dump(page_data, f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save page {page.page_path}: {e}")

    def _save_page_versions(self, page_path: str, versions: List[WikiPageVersion]):
        """Save page versions to individual file."""
        try:
            storage_path = self.get_storage_path()
            versions_dir = storage_path / "versions"
            versions_dir.mkdir(parents=True, exist_ok=True)

            filename = self._encode_page_path_for_filename(page_path) + ".json"
            version_file = versions_dir / filename

            versions_data = [
                (
                    version.model_dump()
                    if hasattr(version, "model_dump")
                    else version.dict()
                )
                for version in versions
            ]

            with open(version_file, "w") as f:
                json.dump(versions_data, f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save versions for page {page_path}: {e}")

    def _save_proposal(self, proposal: WikiEditProposal):
        """Save a single proposal to its own file."""
        try:
            storage_path = self.get_storage_path()
            proposals_dir = storage_path / "proposals"
            proposals_dir.mkdir(parents=True, exist_ok=True)

            proposal_file = proposals_dir / f"{proposal.proposal_id}.json"

            proposal_data = (
                proposal.model_dump()
                if hasattr(proposal, "model_dump")
                else proposal.dict()
            )

            with open(proposal_file, "w") as f:
                json.dump(proposal_data, f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save proposal {proposal.proposal_id}: {e}")

    def _save_metadata(self, page_proposals: Dict[str, List[str]]):
        """Save wiki metadata."""
        try:
            storage_path = self.get_storage_path()
            storage_path.mkdir(parents=True, exist_ok=True)
            metadata_file = storage_path / "metadata.json"

            metadata = {"page_proposals": page_proposals, "last_saved": time.time()}
            with open(metadata_file, "w") as f:
                json.dump(metadata, f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save wiki metadata: {e}")

    async def handle_register_agent(
        self, agent_id: str, metadata: Dict[str, Any]
    ) -> Optional[EventResponse]:
        """Register an agent with the wiki mod.

        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities
        """
        logger.info(f"Registering agent {agent_id} with Wiki mod")

        self.active_agents.add(agent_id)

        # Add agent to wiki threads
        wiki_threads = ["wiki_announcements", "wiki_new_pages", "wiki_recent_changes"]
        for thread_name in wiki_threads:
            self.network.event_gateway.add_channel_member(thread_name, agent_id)
            logger.debug(f"Added agent {agent_id} to wiki thread {thread_name}")

        logger.info(f"Successfully registered agent {agent_id} with Wiki mod")
        return None  # Don't intercept the registration event

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Unregister an agent from the wiki mod.

        Args:
            agent_id: Unique identifier for the agent
        """
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)

            # Remove from wiki threads
            wiki_threads = [
                "wiki_announcements",
                "wiki_new_pages",
                "wiki_recent_changes",
            ]
            for thread_name in wiki_threads:
                members = self.network.event_gateway.get_channel_members(thread_name)
                if agent_id in members:
                    self.network.event_gateway.remove_channel_member(
                        thread_name, agent_id
                    )

            logger.info(f"Unregistered agent {agent_id} from Wiki mod")

        return None  # Don't intercept the unregistration event

    def _get_request_id(self, message) -> str:
        """Extract request_id from message, with fallback to event_id."""
        if hasattr(message, "event_id") and message.event_id:
            return message.event_id
        return str(uuid.uuid4())

    @mod_event_handler("wiki.page.create")
    async def _handle_wiki_page_create(self, event: Event) -> Optional[EventResponse]:
        """Handle wiki page creation."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageCreateMessage(**content)

            # Check if page already exists
            if self.get_page(message.page_path) is not None:
                return EventResponse(
                    success=False,
                    message=f"Page already exists: {message.page_path}",
                    data={
                        "error": f"Page already exists: {message.page_path}",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Create the page
            page = WikiPage(
                page_path=message.page_path,
                title=message.title,
                content=message.wiki_content,
                category=getattr(message, "category", None),
                created_by=message.source_id,
                created_timestamp=message.timestamp,
                current_version=1,
                tags=getattr(message, "tags", []),
            )

            # Create initial version
            version = WikiPageVersion(
                version_id=str(uuid.uuid4()),
                page_path=message.page_path,
                version_number=1,
                content=message.wiki_content,
                edited_by=message.source_id,
                edit_timestamp=message.timestamp,
                edit_type="direct",
            )

            # Store page and version to individual files
            self._save_page(page)
            self._save_page_versions(message.page_path, [version])

            # Update metadata
            page_proposals = self.page_proposals  # This loads current metadata
            if message.page_path not in page_proposals:
                page_proposals[message.page_path] = []
            self._save_metadata(page_proposals)

            # Create page-specific proposal thread
            proposal_thread = (
                f"wiki_page_{message.page_path.replace('/', '_')}_proposals"
            )
            self.network.event_gateway.create_channel(proposal_thread)

            # Add all active agents to the proposal thread
            for agent_id in self.active_agents:
                self.network.event_gateway.add_channel_member(proposal_thread, agent_id)

            # Send notification to new pages thread
            await self._send_new_page_notification(page)

            logger.info(
                f"Created wiki page: {message.page_path} by {message.source_id}"
            )

            return EventResponse(
                success=True,
                message=f"Wiki page created successfully: {message.page_path}",
                data={
                    "page_path": message.page_path,
                    "version": 1,
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error creating wiki page: {e}")
            return EventResponse(
                success=False,
                message=f"Error creating wiki page: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.page.edit")
    async def _handle_wiki_page_edit(self, event: Event) -> Optional[EventResponse]:
        """Handle wiki page editing (owner only)."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageEditMessage(**content)

            # Check if page exists
            page = self.get_page(message.page_path)
            if page is None:
                return EventResponse(
                    success=False,
                    message=f"Page not found: {message.page_path}",
                    data={
                        "error": f"Page not found: {message.page_path}",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Check if agent is the owner
            if page.created_by != message.source_id:
                return EventResponse(
                    success=False,
                    message=f"Only the page owner can edit directly: {message.page_path}",
                    data={
                        "error": f"Only the page owner ({page.created_by}) can edit this page directly",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Create new version
            new_version_number = page.current_version + 1
            version = WikiPageVersion(
                version_id=str(uuid.uuid4()),
                page_path=message.page_path,
                version_number=new_version_number,
                content=message.wiki_content,
                edited_by=message.source_id,
                edit_timestamp=message.timestamp,
                edit_type="direct",
                parent_version=page.current_version,
            )

            # Update page
            page.content = message.wiki_content
            page.current_version = new_version_number

            # Save updated page
            self._save_page(page)

            # Update and save versions
            current_versions = self.get_page_versions(message.page_path)
            current_versions.append(version)
            self._save_page_versions(message.page_path, current_versions)

            # Send notification to recent changes thread
            await self._send_page_edit_notification(page, version)

            logger.info(
                f"Edited wiki page: {message.page_path} by {message.source_id} (v{new_version_number})"
            )

            return EventResponse(
                success=True,
                message=f"Wiki page edited successfully: {message.page_path}",
                data={
                    "page_path": message.page_path,
                    "version": new_version_number,
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error editing wiki page: {e}")
            return EventResponse(
                success=False,
                message=f"Error editing wiki page: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.page.get")
    async def _handle_wiki_page_get(self, event: Event) -> Optional[EventResponse]:
        """Handle wiki page retrieval."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageGetMessage(**content)

            # Check if page exists
            page = self.get_page(message.page_path)
            if page is None:
                return EventResponse(
                    success=False,
                    message=f"Page not found: {message.page_path}",
                    data={
                        "error": f"Page not found: {message.page_path}",
                        "request_id": self._get_request_id(message),
                    },
                )

            versions = self.get_page_versions(message.page_path)

            # Get specific version or latest
            if message.version is not None:
                # Find specific version
                target_version = None
                for version in versions:
                    if version.version_number == message.version:
                        target_version = version
                        break

                if target_version is None:
                    return EventResponse(
                        success=False,
                        message=f"Version {message.version} not found for page: {message.page_path}",
                        data={
                            "error": f"Version {message.version} not found",
                            "request_id": self._get_request_id(message),
                        },
                    )

                page_data = {
                    "page_path": page.page_path,
                    "title": page.title,
                    "wiki_content": target_version.content,  # Use wiki_content to match frontend
                    "category": page.category,
                    "creator_id": page.created_by,  # Use creator_id to match frontend
                    "created_by": page.created_by,
                    "created_timestamp": page.created_timestamp,
                    "version": target_version.version_number,
                    "last_modified": target_version.edit_timestamp,  # Add last_modified for frontend
                    "edited_by": target_version.edited_by,
                    "edit_timestamp": target_version.edit_timestamp,
                    "is_locked": page.is_locked,
                    "protection_level": page.protection_level,
                    "tags": page.tags,
                }
            else:
                # Get latest version
                page_data = {
                    "page_path": page.page_path,
                    "title": page.title,
                    "wiki_content": page.content,  # Use wiki_content to match frontend
                    "category": page.category,
                    "creator_id": page.created_by,  # Use creator_id to match frontend
                    "created_by": page.created_by,
                    "created_timestamp": page.created_timestamp,
                    "version": page.current_version,
                    "last_modified": page.created_timestamp,  # Add last_modified for frontend
                    "is_locked": page.is_locked,
                    "protection_level": page.protection_level,
                    "tags": page.tags,
                }

            return EventResponse(
                success=True,
                message=f"Wiki page retrieved successfully: {message.page_path}",
                data=page_data,  # Return page data directly, not nested
            )

        except Exception as e:
            logger.error(f"Error retrieving wiki page: {e}")
            return EventResponse(
                success=False,
                message=f"Error retrieving wiki page: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.pages.search")
    async def _handle_wiki_pages_search(self, event: Event) -> Optional[EventResponse]:
        """Handle wiki pages search."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageSearchMessage(**content)

            # Simple search implementation
            query_lower = message.query.lower()
            matching_pages = []

            for page in self.pages.values():
                # Search in title and content
                if (
                    query_lower in page.title.lower()
                    or query_lower in page.content.lower()
                    or any(query_lower in tag.lower() for tag in page.tags)
                ):

                    page_summary = {
                        "page_path": page.page_path,
                        "title": page.title,
                        "category": page.category,
                        "created_by": page.created_by,
                        "created_timestamp": page.created_timestamp,
                        "current_version": page.current_version,
                        "tags": page.tags,
                        # Include snippet of content
                        "content_snippet": (
                            page.content[:200] + "..."
                            if len(page.content) > 200
                            else page.content
                        ),
                    }
                    matching_pages.append(page_summary)

            # Sort by creation timestamp (newest first) and limit results
            matching_pages.sort(key=lambda x: x["created_timestamp"], reverse=True)
            matching_pages = matching_pages[: message.limit]

            return EventResponse(
                success=True,
                message=f"Found {len(matching_pages)} matching pages",
                data={
                    "pages": matching_pages,
                    "query": message.query,
                    "total_found": len(matching_pages),
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error searching wiki pages: {e}")
            return EventResponse(
                success=False,
                message=f"Error searching wiki pages: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.pages.list")
    async def _handle_wiki_pages_list(self, event: Event) -> Optional[EventResponse]:
        """Handle wiki pages listing."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageListMessage(**content)

            # Filter pages by category if specified
            pages_list = []
            for page in self.pages.values():
                if message.category is None or page.category == message.category:
                    page_summary = {
                        "page_path": page.page_path,
                        "title": page.title,
                        "category": page.category,
                        "creator_id": page.created_by,  # Use creator_id to match frontend expectation
                        "created_by": page.created_by,
                        "created_timestamp": page.created_timestamp,
                        "current_version": page.current_version,
                        "version": page.current_version,  # Add version field for frontend
                        "last_modified": page.created_timestamp,  # Use created_timestamp as fallback for last_modified
                        "tags": page.tags,
                        "wiki_content": (
                            page.content[:200] if page.content else ""
                        ),  # Add content preview (use 'content' field)
                    }
                    pages_list.append(page_summary)

            # Sort by creation timestamp (newest first) and limit results
            pages_list.sort(key=lambda x: x["created_timestamp"], reverse=True)
            pages_list = pages_list[: message.limit]

            return EventResponse(
                success=True,
                message=f"Listed {len(pages_list)} pages",
                data={
                    "pages": pages_list,
                    "category": message.category,
                    "total_listed": len(pages_list),
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error listing wiki pages: {e}")
            return EventResponse(
                success=False,
                message=f"Error listing wiki pages: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.page.proposal.create")
    async def _handle_wiki_page_proposal_create(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle wiki page edit proposal creation."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageEditProposalMessage(**content)

            # Check if page exists
            if self.get_page(message.page_path) is None:
                return EventResponse(
                    success=False,
                    message=f"Page not found: {message.page_path}",
                    data={
                        "error": f"Page not found: {message.page_path}",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Create proposal
            proposal_id = str(uuid.uuid4())
            proposal = WikiEditProposal(
                proposal_id=proposal_id,
                page_path=message.page_path,
                proposed_content=message.wiki_content,
                rationale=message.rationale,
                proposed_by=message.source_id,
                created_timestamp=message.timestamp,
            )

            # Store proposal to individual file
            self._save_proposal(proposal)

            # Update metadata
            page_proposals = self.page_proposals  # This loads current metadata
            if message.page_path not in page_proposals:
                page_proposals[message.page_path] = []
            page_proposals[message.page_path].append(proposal_id)
            self._save_metadata(page_proposals)

            # Send notification to page proposal thread
            await self._send_proposal_notification(proposal)

            logger.info(
                f"Created edit proposal {proposal_id} for page {message.page_path} by {message.source_id}"
            )

            return EventResponse(
                success=True,
                message=f"Edit proposal created successfully for page: {message.page_path}",
                data={
                    "proposal_id": proposal_id,
                    "page_path": message.page_path,
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error creating edit proposal: {e}")
            return EventResponse(
                success=False,
                message=f"Error creating edit proposal: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.proposals.list")
    async def _handle_wiki_proposals_list(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle wiki edit proposals listing."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiEditProposalListMessage(**content)

            # Filter proposals
            proposals_list = []
            for proposal in self.proposals.values():
                # Filter by page_path if specified
                if (
                    message.page_path is not None
                    and proposal.page_path != message.page_path
                ):
                    continue

                # Filter by status
                if proposal.status != message.status:
                    continue

                # Filter by page owner, only show proposals for pages that the agent has created
                page = self.get_page(proposal.page_path)
                if page is None:
                    continue

                if page.created_by != message.source_id:
                    continue

                # Get old content of the page
                old_content = page.content

                proposal_data = {
                    "proposal_id": proposal.proposal_id,
                    "page_path": proposal.page_path,
                    "old_content": old_content,
                    "proposed_content": proposal.proposed_content,
                    "rationale": proposal.rationale,
                    "proposed_by": proposal.proposed_by,
                    "created_timestamp": proposal.created_timestamp,
                    "status": proposal.status,
                    "resolved_by": proposal.resolved_by,
                    "resolved_timestamp": proposal.resolved_timestamp,
                    "resolution_comments": proposal.resolution_comments,
                }
                proposals_list.append(proposal_data)

            # Sort by creation timestamp (newest first)
            proposals_list.sort(key=lambda x: x["created_timestamp"], reverse=True)

            return EventResponse(
                success=True,
                message=f"Listed {len(proposals_list)} proposals",
                data={
                    "proposals": proposals_list,
                    "page_path": message.page_path,
                    "status": message.status,
                    "total_listed": len(proposals_list),
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error listing proposals: {e}")
            return EventResponse(
                success=False,
                message=f"Error listing proposals: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.proposal.resolve")
    async def _handle_wiki_proposal_resolve(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle wiki edit proposal resolution."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiEditProposalResolveMessage(**content)

            # Check if proposal exists
            proposal = self.get_proposal(message.proposal_id)
            if proposal is None:
                return EventResponse(
                    success=False,
                    message=f"Proposal not found: {message.proposal_id}",
                    data={
                        "error": f"Proposal not found: {message.proposal_id}",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Check if proposal is still pending
            if proposal.status != "pending":
                return EventResponse(
                    success=False,
                    message=f"Proposal already resolved: {message.proposal_id}",
                    data={
                        "error": f"Proposal already resolved with status: {proposal.status}",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Check if page exists
            page = self.get_page(proposal.page_path)
            if page is None:
                return EventResponse(
                    success=False,
                    message=f"Page not found: {proposal.page_path}",
                    data={
                        "error": f"Page not found: {proposal.page_path}",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Check if agent is the page owner
            if page.created_by != message.source_id:
                return EventResponse(
                    success=False,
                    message=f"Only the page owner can resolve proposals: {proposal.page_path}",
                    data={
                        "error": f"Only the page owner ({page.created_by}) can resolve proposals for this page",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Resolve the proposal
            proposal.status = message.action  # "approve" or "reject"
            proposal.resolved_by = message.source_id
            proposal.resolved_timestamp = message.timestamp
            proposal.resolution_comments = message.comments

            # If approved, apply the changes
            if message.action == "approve":
                # Create new version
                new_version_number = page.current_version + 1
                version = WikiPageVersion(
                    version_id=str(uuid.uuid4()),
                    page_path=proposal.page_path,
                    version_number=new_version_number,
                    content=proposal.proposed_content,
                    edited_by=proposal.proposed_by,  # Credit the proposer
                    edit_timestamp=message.timestamp,
                    edit_type="proposal_approved",
                    parent_version=page.current_version,
                )

                # Update page
                page.content = proposal.proposed_content
                page.current_version = new_version_number

                # Save updated page
                self._save_page(page)

                # Update and save versions
                current_versions = self.get_page_versions(proposal.page_path)
                current_versions.append(version)
                self._save_page_versions(proposal.page_path, current_versions)

            # Save updated proposal
            self._save_proposal(proposal)

            # Send notification about page edit (only if approved)
            if message.action == "approve":
                await self._send_page_edit_notification(page, version)

            # Send notification about proposal resolution
            await self._send_proposal_resolution_notification(proposal)

            logger.info(
                f"Resolved proposal {message.proposal_id} with action {message.action} by {message.source_id}"
            )

            return EventResponse(
                success=True,
                message=f"Proposal resolved successfully: {message.action}",
                data={
                    "proposal_id": message.proposal_id,
                    "action": message.action,
                    "page_path": proposal.page_path,
                    "new_version": (
                        page.current_version if message.action == "approve" else None
                    ),
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error resolving proposal: {e}")
            return EventResponse(
                success=False,
                message=f"Error resolving proposal: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.page.history")
    async def _handle_wiki_page_history(self, event: Event) -> Optional[EventResponse]:
        """Handle wiki page history retrieval."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageHistoryMessage(**content)

            # Check if page exists
            if self.get_page(message.page_path) is None:
                return EventResponse(
                    success=False,
                    message=f"Page not found: {message.page_path}",
                    data={
                        "error": f"Page not found: {message.page_path}",
                        "request_id": self._get_request_id(message),
                    },
                )

            versions = self.get_page_versions(message.page_path)

            # Sort versions by version number (newest first) and limit
            sorted_versions = sorted(
                versions, key=lambda v: v.version_number, reverse=True
            )
            limited_versions = sorted_versions[: message.limit]

            # Convert to response format
            versions_data = []
            for version in limited_versions:
                version_data = {
                    "version_id": version.version_id,
                    "version_number": version.version_number,
                    "edited_by": version.edited_by,
                    "edit_timestamp": version.edit_timestamp,
                    "edit_type": version.edit_type,
                    "parent_version": version.parent_version,
                    # Include content snippet
                    "content_snippet": (
                        version.content[:200] + "..."
                        if len(version.content) > 200
                        else version.content
                    ),
                }
                versions_data.append(version_data)

            return EventResponse(
                success=True,
                message=f"Retrieved {len(versions_data)} versions for page: {message.page_path}",
                data={
                    "versions": versions_data,
                    "page_path": message.page_path,
                    "total_versions": len(versions),
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error retrieving page history: {e}")
            return EventResponse(
                success=False,
                message=f"Error retrieving page history: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    @mod_event_handler("wiki.page.revert")
    async def _handle_wiki_page_revert(self, event: Event) -> Optional[EventResponse]:
        """Handle wiki page reversion."""
        try:
            content = event.payload.copy()
            content["source_id"] = event.source_id  # Add source_id from Event
            message = WikiPageRevertMessage(**content)

            # Check if page exists
            page = self.get_page(message.page_path)
            if page is None:
                return EventResponse(
                    success=False,
                    message=f"Page not found: {message.page_path}",
                    data={
                        "error": f"Page not found: {message.page_path}",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Check if agent is the owner
            if page.created_by != message.source_id:
                return EventResponse(
                    success=False,
                    message=f"Only the page owner can revert: {message.page_path}",
                    data={
                        "error": f"Only the page owner ({page.created_by}) can revert this page",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Find target version
            versions = self.get_page_versions(message.page_path)
            target_version = None
            for version in versions:
                if version.version_number == message.target_version:
                    target_version = version
                    break

            if target_version is None:
                return EventResponse(
                    success=False,
                    message=f"Version {message.target_version} not found for page: {message.page_path}",
                    data={
                        "error": f"Version {message.target_version} not found",
                        "request_id": self._get_request_id(message),
                    },
                )

            # Create new version with reverted content
            new_version_number = page.current_version + 1
            revert_version = WikiPageVersion(
                version_id=str(uuid.uuid4()),
                page_path=message.page_path,
                version_number=new_version_number,
                content=target_version.content,
                edited_by=message.source_id,
                edit_timestamp=message.timestamp,
                edit_type="revert",
                parent_version=page.current_version,
            )

            # Update page
            page.content = target_version.content
            page.current_version = new_version_number

            # Store version
            versions.append(revert_version)

            # Save data after page revert
            # Data now stored in storage

            # Send notification
            await self._send_page_edit_notification(page, revert_version)

            logger.info(
                f"Reverted page {message.page_path} to version {message.target_version} by {message.source_id}"
            )

            return EventResponse(
                success=True,
                message=f"Page reverted successfully to version {message.target_version}",
                data={
                    "page_path": message.page_path,
                    "reverted_to_version": message.target_version,
                    "new_version": new_version_number,
                    "request_id": self._get_request_id(message),
                },
            )

        except Exception as e:
            logger.error(f"Error reverting page: {e}")
            return EventResponse(
                success=False,
                message=f"Error reverting page: {str(e)}",
                data={
                    "error": str(e),
                    "request_id": self._get_request_id(event.payload),
                },
            )

    async def _send_new_page_notification(self, page: WikiPage) -> None:
        """Send notification about new page creation."""
        try:
            notification = Event(
                event_name="wiki.page.notification",
                source_id=self.network.network_id,
                destination_id="channel:wiki_new_pages",
                payload={
                    "action": "page_created",
                    "page_path": page.page_path,
                    "title": page.title,
                    "created_by": page.created_by,
                    "created_timestamp": page.created_timestamp,
                    "category": page.category,
                    "tags": page.tags,
                    "content": page.content,
                },
            )

            await self.network.process_event(notification)
            logger.debug(f"Sent new page notification for {page.page_path}")

        except Exception as e:
            logger.error(f"Error sending new page notification: {e}")

    async def _send_page_edit_notification(
        self, page: WikiPage, version: WikiPageVersion
    ) -> None:
        """Send notification about page edit."""
        try:
            notification = Event(
                event_name="wiki.page.notification",
                source_id=self.network.network_id,
                destination_id="channel:wiki_recent_changes",
                payload={
                    "action": "page_edited",
                    "page_path": page.page_path,
                    "title": page.title,
                    "content": page.content,
                    "edited_by": version.edited_by,
                    "edit_timestamp": version.edit_timestamp,
                    "version": version.version_number,
                    "edit_type": version.edit_type,
                },
            )

            await self.network.process_event(notification)
            logger.debug(
                f"Sent page edit notification for {page.page_path} v{version.version_number}"
            )

        except Exception as e:
            logger.error(f"Error sending page edit notification: {e}")

    async def _send_proposal_notification(self, proposal: WikiEditProposal) -> None:
        """Send notification about new proposal."""
        try:
            # Send to page-specific proposal thread
            proposal_thread = (
                f"wiki_page_{proposal.page_path.replace('/', '_')}_proposals"
            )

            notification = Event(
                event_name="wiki.proposal.notification",
                source_id=self.network.network_id,
                destination_id=f"channel:{proposal_thread}",
                payload={
                    "action": "proposal_created",
                    "proposal_id": proposal.proposal_id,
                    "page_path": proposal.page_path,
                    "proposed_by": proposal.proposed_by,
                    "created_timestamp": proposal.created_timestamp,
                    "rationale": proposal.rationale,
                },
            )

            await self.network.process_event(notification)
            logger.debug(f"Sent proposal notification for {proposal.proposal_id}")

        except Exception as e:
            logger.error(f"Error sending proposal notification: {e}")

    async def _send_proposal_resolution_notification(
        self, proposal: WikiEditProposal
    ) -> None:
        """Send notification about proposal resolution."""
        try:
            # Send to page-specific proposal thread
            proposal_thread = (
                f"wiki_page_{proposal.page_path.replace('/', '_')}_proposals"
            )

            notification = Event(
                event_name="wiki.proposal.notification",
                source_id=self.network.network_id,
                destination_id=f"channel:{proposal_thread}",
                payload={
                    "action": "proposal_resolved",
                    "proposal_id": proposal.proposal_id,
                    "page_path": proposal.page_path,
                    "proposed_by": proposal.proposed_by,
                    "resolved_by": proposal.resolved_by,
                    "resolved_timestamp": proposal.resolved_timestamp,
                    "status": proposal.status,
                    "resolution_comments": proposal.resolution_comments,
                },
            )

            await self.network.process_event(notification)
            logger.debug(
                f"Sent proposal resolution notification for {proposal.proposal_id}"
            )

        except Exception as e:
            logger.error(f"Error sending proposal resolution notification: {e}")

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the Wiki mod.

        Returns:
            Dict[str, Any]: Current mod state
        """
        return {
            "active_agents": len(self.active_agents),
            "total_pages": len(self.pages),
            "total_versions": sum(
                len(versions) for versions in self.page_versions.values()
            ),
            "pending_proposals": len(
                [p for p in self.proposals.values() if p.status == "pending"]
            ),
            "total_proposals": len(self.proposals),
            "pages": list(self.pages.keys()),
        }
