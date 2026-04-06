"""
Network-level documents mod for OpenAgents.

This standalone mod enables document management with:
- Document creation and storage
- Document saving and content persistence
- Document renaming
- Version control
- Operation history tracking
"""

import logging
import uuid
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime

from openagents.config.globals import BROADCAST_AGENT_ID
from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from .document_messages import (
    CreateDocumentMessage,
    SaveDocumentMessage,
    RenameDocumentMessage,
    GetDocumentMessage,
    GetDocumentHistoryMessage,
    ListDocumentsMessage,
    DocumentOperationResponse,
    DocumentGetResponse,
    DocumentListResponse,
    DocumentHistoryResponse,
    DocumentOperation,
)

# Initialize logger first
logger = logging.getLogger(__name__)

# Try to import Yjs for decoding
try:
    import y_py as Y
    HAS_YJS = True
    logger.info("y-py is available for Yjs state decoding")
except ImportError:
    HAS_YJS = False
    logger.warning("y-py not installed. Yjs state decoding will be disabled.")


class Document:
    """Represents a document with version control."""

    def __init__(
        self,
        document_id: str,
        name: str,
        creator_agent_id: str,
        initial_content: str = "",
    ):
        """Initialize a document."""
        self.document_id = document_id
        self.name = name
        self.creator_agent_id = creator_agent_id
        self.created_timestamp = datetime.now()
        self.last_modified = datetime.now()
        self.version = 1

        # Document content (string)
        self.content: str = initial_content

        # Document metadata
        self.access_permissions: Dict[str, str] = {}  # agent_id -> permission level
        self.operation_history: List[Dict[str, Any]] = []
        self.active_users: List[str] = []  # List of agent_ids currently viewing the document

        # Real-time collaboration
        self.cursor_positions: Dict[str, Dict[str, int]] = {}  # agent_id -> {line, column}
        self.pending_edits: List[Dict[str, Any]] = []  # List of pending edit operations

        # Yjs CRDT state (for conflict-free collaborative editing)
        self.yjs_state: Optional[List[int]] = None  # Stores the latest Yjs document state

        # Persistent Y.Doc instance for proper CRDT merging
        if HAS_YJS:
            self.ydoc = Y.YDoc()
            self.ytext = self.ydoc.get_text('monaco')
            # Initialize with initial content if provided
            if initial_content:
                # Must use a transaction to properly record in CRDT
                with self.ydoc.begin_transaction() as txn:
                    self.ytext.extend(txn, initial_content)
                # Capture the initial state
                self.yjs_state = list(Y.encode_state_as_update(self.ydoc))
        else:
            self.ydoc = None
            self.ytext = None

        # Auto-save mechanism
        self.is_dirty: bool = False  # Tracks if content has changed since last save
        self.auto_save_task: Optional[asyncio.Task] = None  # Auto-save timer task
        self.auto_save_delay: float = 3.0  # Delay in seconds before auto-save triggers

    def apply_edit(self, agent_id: str, operation: Dict[str, Any]) -> bool:
        """Apply an edit operation to the document content.

        Now supports multi-line operations using character-level positions.
        """
        try:
            op_type = operation.get("type")
            line = operation.get("line", 0)
            column = operation.get("column", 0)

            # Convert line/column to character position
            lines = self.content.split('\n') if self.content else ['']

            # Calculate character position from line/column
            char_pos = 0
            for i in range(min(line, len(lines))):
                char_pos += len(lines[i]) + 1  # +1 for newline
            char_pos += min(column, len(lines[line]) if line < len(lines) else 0)

            # Perform operation at character level (supports multi-line)
            if op_type == "insert":
                text = operation.get("text", "")
                self.content = self.content[:char_pos] + text + self.content[char_pos:]

            elif op_type == "delete":
                length = operation.get("length", 0)
                self.content = self.content[:char_pos] + self.content[char_pos + length:]

            elif op_type == "replace":
                text = operation.get("text", "")
                length = operation.get("length", 0)
                self.content = self.content[:char_pos] + text + self.content[char_pos + length:]

            self.last_modified = datetime.now()

            # Add to pending edits
            edit_record = {
                "operation_id": str(uuid.uuid4()),
                "agent_id": agent_id,
                "timestamp": self.last_modified.isoformat(),
                "operation": operation,
            }
            self.pending_edits.append(edit_record)

            logger.info(f"Applied {op_type} edit at line={line}, col={column} (char_pos={char_pos})")
            return True
        except Exception as e:
            logger.error(f"Error applying edit: {e}", exc_info=True)
            return False

    def update_cursor(self, agent_id: str, line: int, column: int) -> None:
        """Update cursor position for an agent."""
        self.cursor_positions[agent_id] = {"line": line, "column": column}

    def save_content(self, agent_id: str, content: str) -> None:
        """Save document content."""
        self.content = content
        self.version += 1
        self.last_modified = datetime.now()

        # Clear pending edits after save
        self.pending_edits = []

        # Add to operation history
        self.operation_history.append({
            "operation_id": str(uuid.uuid4()),
            "operation_type": "save",
            "agent_id": agent_id,
            "timestamp": self.last_modified.isoformat(),
            "details": {"version": self.version},
        })

    def rename(self, agent_id: str, new_name: str) -> None:
        """Rename the document."""
        old_name = self.name
        self.name = new_name
        self.last_modified = datetime.now()

        # Add to operation history
        self.operation_history.append({
            "operation_id": str(uuid.uuid4()),
            "operation_type": "rename",
            "agent_id": agent_id,
            "timestamp": self.last_modified.isoformat(),
            "details": {"old_name": old_name, "new_name": new_name},
        })

    def enter_document(self, agent_id: str) -> None:
        """Mark an agent as entering/viewing the document."""
        if agent_id not in self.active_users:
            self.active_users.append(agent_id)
            # Add to operation history
            self.operation_history.append({
                "operation_id": str(uuid.uuid4()),
                "operation_type": "enter",
                "agent_id": agent_id,
                "timestamp": datetime.now().isoformat(),
                "details": {},
            })

    def leave_document(self, agent_id: str) -> None:
        """Mark an agent as leaving the document."""
        if agent_id in self.active_users:
            self.active_users.remove(agent_id)
            # Add to operation history
            self.operation_history.append({
                "operation_id": str(uuid.uuid4()),
                "operation_type": "leave",
                "agent_id": agent_id,
                "timestamp": datetime.now().isoformat(),
                "details": {},
            })

    def can_access(self, agent_id: str, operation: str) -> bool:
        """Check if agent can access the document for the given operation.

        Permission logic:
        - Creator always has full access
        - If access_permissions is empty (public document), everyone can read
        - If access_permissions is not empty (restricted), only explicit permissions apply
        """
        # TEMPORARILY DISABLED FOR TESTING - Allow all access
        return True

        # # Creator always has access
        # if agent_id == self.creator_agent_id:
        #     return True

        # # If access_permissions is empty, document is public (everyone can read)
        # if not self.access_permissions:
        #     return operation in ["read"]

        # # Check explicit permissions for restricted documents
        # if agent_id not in self.access_permissions:
        #     return False

        # permission = self.access_permissions[agent_id]

        # if permission == "read_only":
        #     return operation in ["read"]
        # elif permission == "read_write":
        #     return True
        # elif permission == "admin":
        #     return True

        # return False

    def decode_yjs_state_to_content(self) -> Optional[str]:
        """Decode Yjs state to plain text content.

        Returns:
            Decoded text content or None if decoding fails
        """
        if not HAS_YJS or not self.yjs_state:
            return None

        try:
            # Create a temporary Y.Doc and apply the state
            ydoc = Y.YDoc()
            state_bytes = bytes(self.yjs_state)
            Y.apply_update(ydoc, state_bytes)

            # Get the text from the 'monaco' shared type
            ytext = ydoc.get_text('monaco')
            content = str(ytext)

            logger.info(f"Decoded Yjs state to text, length: {len(content)}")
            return content
        except Exception as e:
            logger.error(f"Failed to decode Yjs state: {e}", exc_info=True)
            return None

    async def schedule_auto_save(self, save_callback):
        """Schedule an auto-save after a delay (debounced).

        Args:
            save_callback: Async function to call when auto-save triggers
        """
        # Cancel existing auto-save task if any
        if self.auto_save_task and not self.auto_save_task.done():
            self.auto_save_task.cancel()
            logger.debug(f"Cancelled previous auto-save task for document {self.document_id}")

        async def _auto_save():
            try:
                await asyncio.sleep(self.auto_save_delay)
                if self.is_dirty:
                    logger.info(f"Auto-save triggered for document {self.document_id}")
                    await save_callback(self)
                    self.is_dirty = False
            except asyncio.CancelledError:
                logger.debug(f"Auto-save task cancelled for document {self.document_id}")
            except Exception as e:
                logger.error(f"Error in auto-save: {e}", exc_info=True)

        # Create and store new auto-save task
        self.auto_save_task = asyncio.create_task(_auto_save())
        logger.debug(f"Scheduled auto-save in {self.auto_save_delay}s for document {self.document_id}")

    async def force_save_if_dirty(self, save_callback) -> bool:
        """Force save immediately if document is dirty.

        Args:
            save_callback: Async function to call for saving

        Returns:
            True if save was performed, False otherwise
        """
        if self.is_dirty:
            logger.info(f"Force saving dirty document {self.document_id}")
            await save_callback(self)
            self.is_dirty = False
            return True
        return False


class DocumentsNetworkMod(BaseMod):
    """Network-level documents mod implementation.

    This standalone mod enables:
    - Document creation and storage
    - Document saving
    - Document renaming
    - Version control and history
    """

    def __init__(self, mod_name: str = "documents"):
        """Initialize the documents mod."""
        super().__init__(mod_name=mod_name)

        # Document storage
        self.documents: Dict[str, Document] = {}

    def initialize(self) -> bool:
        """Initialize the mod."""
        logger.info("Initializing Documents network mod")
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod."""
        logger.info("Shutting down Documents network mod")
        return True

    async def _auto_save_document(self, document: Document):
        """Auto-save callback for documents.

        Args:
            document: Document to save
        """
        try:
            logger.info(f"Auto-saving document {document.document_id}")
            # Save content with system as the agent
            document.save_content("system", document.content)
            logger.info(f"Auto-save completed for document {document.document_id}, version: {document.version}")
        except Exception as e:
            logger.error(f"Error in auto-save for document {document.document_id}: {e}", exc_info=True)

    # Event handlers

    @mod_event_handler("document.create")
    async def _handle_document_create(self, event: Event) -> Optional[EventResponse]:
        """Handle document creation requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            logger.info(f"Processing document create request from {source_agent_id}")

            # Extract payload
            payload = event.payload
            document_name = payload.get("document_name")
            initial_content = payload.get("initial_content", "")
            access_permissions = payload.get("access_permissions", {})

            # Create document
            document_id = str(uuid.uuid4())
            document = Document(
                document_id=document_id,
                name=document_name,
                creator_agent_id=source_agent_id,
                initial_content=initial_content,
            )

            # Set access permissions
            document.access_permissions = access_permissions

            self.documents[document_id] = document

            # Add to operation history
            document.operation_history.append({
                "operation_id": str(uuid.uuid4()),
                "operation_type": "create",
                "agent_id": source_agent_id,
                "timestamp": document.created_timestamp.isoformat(),
                "details": {"document_name": document_name},
            })

            logger.info(
                f"Created document {document_id} '{document_name}' for agent {source_agent_id}"
            )

            # Send notification event to all agents
            await self._send_document_notification(
                "document.created", document, source_agent_id
            )

            return EventResponse(
                success=True,
                message=f"Document '{document_name}' created successfully",
                data={
                    "document_id": document_id,
                    "document_name": document_name,
                    "creator_id": source_agent_id,
                    "content": document.content,
                },
            )

        except Exception as e:
            logger.error(f"Error creating document: {e}")
            return EventResponse(
                success=False, message=f"Failed to create document: {str(e)}"
            )

    @mod_event_handler("document.save")
    async def _handle_document_save(self, event: Event) -> Optional[EventResponse]:
        """Handle document save requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")
            content = payload.get("content", "")

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions - TEMPORARILY DISABLED FOR TESTING
            # if not document.can_access(source_agent_id, "write"):
            #     return EventResponse(success=False, message="Access denied")

            # Save content
            document.save_content(source_agent_id, content)

            # Send notification event to all agents with access
            await self._send_document_notification(
                "document.saved", document, source_agent_id
            )

            return EventResponse(
                success=True,
                message=f"Document saved successfully",
                data={
                    "document_id": document_id,
                    "version": document.version,
                },
            )

        except Exception as e:
            logger.error(f"Error saving document: {e}")
            return EventResponse(
                success=False, message=f"Failed to save document: {str(e)}"
            )

    @mod_event_handler("document.edit")
    async def _handle_document_edit(self, event: Event) -> Optional[EventResponse]:
        """Handle real-time document edit requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")
            operation = payload.get("operation", {})
            version = payload.get("version", 0)

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions - TEMPORARILY DISABLED FOR TESTING
            # if not document.can_access(source_agent_id, "write"):
            #     return EventResponse(success=False, message="Access denied")

            # Apply edit operation
            success = document.apply_edit(source_agent_id, operation)

            if not success:
                return EventResponse(
                    success=False, message="Failed to apply edit operation"
                )

            # Update cursor position if provided
            cursor = payload.get("cursor")
            if cursor:
                document.update_cursor(
                    source_agent_id, cursor.get("line", 0), cursor.get("column", 0)
                )

            # Broadcast edit to other users with operation details
            await self._send_document_notification(
                "document.edited", document, source_agent_id, extra_payload={"operation": operation}
            )

            return EventResponse(
                success=True,
                message="Edit applied successfully",
                data={
                    "document_id": document_id,
                    "version": document.version,
                },
            )

        except Exception as e:
            logger.error(f"Error applying edit: {e}")
            return EventResponse(
                success=False, message=f"Failed to apply edit: {str(e)}"
            )

    @mod_event_handler("document.update_cursor")
    async def _handle_document_update_cursor(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle cursor position update requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")
            line = payload.get("line", 0)
            column = payload.get("column", 0)

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Update cursor position
            document.update_cursor(source_agent_id, line, column)

            # Broadcast cursor update to other users
            await self._send_document_notification(
                "document.cursor_updated", document, source_agent_id
            )

            return EventResponse(
                success=True,
                message="Cursor updated successfully",
                data={"document_id": document_id},
            )

        except Exception as e:
            logger.error(f"Error updating cursor: {e}")
            return EventResponse(
                success=False, message=f"Failed to update cursor: {str(e)}"
            )

    @mod_event_handler("document.yjs_update")
    async def _handle_yjs_update(self, event: Event) -> Optional[EventResponse]:
        """Handle Yjs update events for CRDT-based collaboration."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")
            update = payload.get("update")  # Array of bytes

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            logger.info(f"Received Yjs update for document {document_id} from {source_agent_id}")

            # Apply the update to the persistent Y.Doc if available
            if HAS_YJS and document.ydoc is not None:
                try:
                    # Apply the incremental update to the persistent Y.Doc
                    update_bytes = bytes(update)
                    Y.apply_update(document.ydoc, update_bytes)

                    # Encode the full document state after applying the update
                    full_state = Y.encode_state_as_update(document.ydoc)
                    document.yjs_state = list(full_state)

                    logger.info(f"✅ Applied Yjs update and encoded full state, size: {len(document.yjs_state)}")

                    # Update document.content from the Y.Doc text
                    decoded_content = str(document.ytext)
                    document.content = decoded_content
                    document.last_modified = datetime.now()
                    document.is_dirty = True
                    logger.info(f"✅ Synced document.content from Yjs, length: {len(decoded_content)}")

                    # Schedule auto-save (debounced - cancels previous timer)
                    await document.schedule_auto_save(self._auto_save_document)
                except Exception as e:
                    logger.error(f"Error applying Yjs update: {e}", exc_info=True)
                    # Fallback to old behavior
                    document.yjs_state = update
                    logger.warning(f"⚠️ Fell back to storing raw update")
            else:
                # Fallback when y-py is not available
                if document.yjs_state is None:
                    document.yjs_state = update
                    logger.info(f"Initialized Yjs state (no y-py), size: {len(update)}")
                else:
                    document.yjs_state = update
                    logger.warning(f"⚠️ Replaced Yjs state (no y-py available for merging), size: {len(update)}")

            # Broadcast Yjs update to all other users viewing the document
            await self._broadcast_to_document_users(
                document_id=document_id,
                event_name="document.yjs_update",
                payload={
                    "document_id": document_id,
                    "update": update,
                    "source_agent_id": source_agent_id,
                },
                exclude_agent_id=source_agent_id,  # Don't echo back to sender
            )

            logger.info(f"Broadcasted Yjs update to active users: {document.active_users}")

            return EventResponse(
                success=True,
                message="Yjs update broadcasted successfully",
                data={"document_id": document_id},
            )

        except Exception as e:
            logger.error(f"Error handling Yjs update: {e}", exc_info=True)
            return EventResponse(
                success=False, message=f"Failed to handle Yjs update: {str(e)}"
            )

    @mod_event_handler("document.yjs_sync")
    async def _handle_yjs_sync(self, event: Event) -> Optional[EventResponse]:
        """Handle Yjs sync request - return the full document state."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            logger.info(f"Yjs sync requested for document {document_id} by {source_agent_id}")
            logger.info(f"Active users: {document.active_users}")
            logger.info(f"Has Yjs state: {document.yjs_state is not None}")
            logger.info(f"Has Y.Doc: {document.ydoc is not None}")

            # If we have a persistent Y.Doc, encode its full state
            if HAS_YJS and document.ydoc is not None:
                try:
                    full_state = Y.encode_state_as_update(document.ydoc)
                    document.yjs_state = list(full_state)
                    logger.info(f"✅ Encoded full state from Y.Doc, size: {len(document.yjs_state)}")

                    return EventResponse(
                        success=True,
                        message="Yjs state retrieved successfully",
                        data={"yjs_state": document.yjs_state},
                    )
                except Exception as e:
                    logger.error(f"Error encoding Y.Doc state: {e}", exc_info=True)

            # Fallback: If we have stored Yjs state, return it
            if document.yjs_state:
                logger.info(f"Returning stored Yjs state, size: {len(document.yjs_state)}")
                return EventResponse(
                    success=True,
                    message="Yjs state retrieved successfully",
                    data={"yjs_state": document.yjs_state},
                )
            else:
                # No Yjs state stored yet (first user)
                logger.info("No Yjs state stored yet - client should use initial content")
                return EventResponse(
                    success=False,
                    message="No Yjs state available - use initial content",
                    data={},
                )

        except Exception as e:
            logger.error(f"Error handling Yjs sync: {e}")
            return EventResponse(
                success=False, message=f"Failed to handle Yjs sync: {str(e)}"
            )

    @mod_event_handler("document.cursor_update")
    async def _handle_cursor_update(self, event: Event) -> Optional[EventResponse]:
        """Handle cursor position updates for Yjs-based editor."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")
            position = payload.get("position", {})

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Update cursor in document state
            line = position.get("lineNumber", 0)
            column = position.get("column", 0)
            document.update_cursor(source_agent_id, line, column)

            # Broadcast cursor update to other users
            await self._broadcast_to_document_users(
                document_id=document_id,
                event_name="document.cursor_update",
                payload={
                    "document_id": document_id,
                    "agent_id": source_agent_id,
                    "position": position,
                },
                exclude_agent_id=source_agent_id,  # Don't echo back to sender
            )

            return EventResponse(
                success=True,
                message="Cursor update broadcasted successfully",
                data={"document_id": document_id},
            )

        except Exception as e:
            logger.error(f"Error handling cursor update: {e}")
            return EventResponse(
                success=False, message=f"Failed to handle cursor update: {str(e)}"
            )

    @mod_event_handler("document.rename")
    async def _handle_document_rename(self, event: Event) -> Optional[EventResponse]:
        """Handle document rename requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")
            new_name = payload.get("new_name")

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions - TEMPORARILY DISABLED FOR TESTING
            # if not document.can_access(source_agent_id, "write"):
            #     return EventResponse(success=False, message="Access denied")

            # Rename document
            old_name = document.name
            document.rename(source_agent_id, new_name)

            # Send notification event to all agents with access
            await self._send_document_notification(
                "document.renamed", document, source_agent_id
            )

            return EventResponse(
                success=True,
                message=f"Document renamed successfully",
                data={
                    "document_id": document_id,
                    "old_name": old_name,
                    "new_name": new_name,
                },
            )

        except Exception as e:
            logger.error(f"Error renaming document: {e}")
            return EventResponse(
                success=False, message=f"Failed to rename document: {str(e)}"
            )

    @mod_event_handler("document.get")
    async def _handle_document_get(self, event: Event) -> Optional[EventResponse]:
        """Handle get document content requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions - TEMPORARILY DISABLED FOR TESTING
            # if not document.can_access(source_agent_id, "read"):
            #     return EventResponse(success=False, message="Access denied")

            # Mark user as entering the document
            was_already_active = source_agent_id in document.active_users
            document.enter_document(source_agent_id)

            response_data = {
                "document_id": document_id,
                "document_name": document.name,
                "content": document.content,
                "version": document.version,
                "creator_agent_id": document.creator_agent_id,
                "created_timestamp": document.created_timestamp.isoformat(),
                "last_modified": document.last_modified.isoformat(),
                "active_users": document.active_users,
            }

            # Send enter notification if user wasn't already in the document
            if not was_already_active:
                await self._send_document_notification(
                    "document.user_entered", document, source_agent_id
                )

            return EventResponse(
                success=True, message="Document content retrieved", data=response_data
            )

        except Exception as e:
            logger.error(f"Error getting document content: {e}")
            return EventResponse(
                success=False, message=f"Failed to get document content: {str(e)}"
            )

    @mod_event_handler("document.get_history")
    async def _handle_document_get_history(
        self, event: Event
    ) -> Optional[EventResponse]:
        """Handle get document history requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")
            limit = int(payload.get("limit", 50))
            offset = int(payload.get("offset", 0))

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions - TEMPORARILY DISABLED FOR TESTING
            # if not document.can_access(source_agent_id, "read"):
            #     return EventResponse(success=False, message="Access denied")

            # Get paginated history
            total_operations = len(document.operation_history)
            operations = document.operation_history[offset : offset + limit]

            return EventResponse(
                success=True,
                message="Document history retrieved",
                data={
                    "document_id": document_id,
                    "operations": operations,
                    "total_operations": total_operations,
                },
            )

        except Exception as e:
            logger.error(f"Error getting document history: {e}")
            return EventResponse(
                success=False, message=f"Failed to get document history: {str(e)}"
            )

    @mod_event_handler("document.leave")
    async def _handle_document_leave(self, event: Event) -> Optional[EventResponse]:
        """Handle user leaving document."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )
            payload = event.payload
            document_id = payload.get("document_id")

            if document_id not in self.documents:
                return EventResponse(
                    success=False, message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check if user was actually in the document
            was_active = source_agent_id in document.active_users

            # Mark user as leaving the document
            document.leave_document(source_agent_id)

            # 🔥 NEW: If this is the last user leaving, force save any unsaved changes
            if len(document.active_users) == 0 and document.is_dirty:
                logger.info(f"Last user leaving document {document_id}, forcing save")
                saved = await document.force_save_if_dirty(self._auto_save_document)
                if saved:
                    logger.info(f"✅ Document {document_id} saved on last user leave")

            # Send leave notification if user was actually in the document
            if was_active:
                await self._send_document_notification(
                    "document.user_left", document, source_agent_id
                )

            return EventResponse(
                success=True,
                message="Left document successfully",
                data={
                    "document_id": document_id,
                    "active_users": document.active_users,
                },
            )

        except Exception as e:
            logger.error(f"Error leaving document: {e}", exc_info=True)
            return EventResponse(
                success=False, message=f"Failed to leave document: {str(e)}"
            )

    @mod_event_handler("document.list")
    async def _handle_document_list(self, event: Event) -> Optional[EventResponse]:
        """Handle list documents requests."""
        try:
            source_agent_id = (
                event.source_id.replace("agent:", "")
                if event.source_id.startswith("agent:")
                else event.source_id
            )

            # Get documents accessible to the agent - TEMPORARILY DISABLED FOR TESTING
            accessible_docs = []
            for doc_id, document in self.documents.items():
                # if document.can_access(source_agent_id, "read"):  # Permission check disabled
                accessible_docs.append(
                    {
                        "document_id": doc_id,
                        "name": document.name,
                        "creator_agent_id": document.creator_agent_id,
                        "created_timestamp": document.created_timestamp.isoformat(),
                        "last_modified": document.last_modified.isoformat(),
                        "version": document.version,
                    }
                )

            return EventResponse(
                success=True,
                message="Documents listed successfully",
                data={"documents": accessible_docs},
            )

        except Exception as e:
            logger.error(f"Error listing documents: {e}")
            return EventResponse(
                success=False, message=f"Failed to list documents: {str(e)}"
            )

    async def _send_document_notification(
        self, event_name: str, document: Document, source_id: str, extra_payload: Dict[str, Any] = None
    ):
        """Send document-related notifications to agents with permission.

        Documents with access_permissions:
        - Send individual notifications to agents with access
        Documents without access_permissions (public):
        - Broadcast to all agents

        Args:
            event_name: Name of the event to send
            document: Document object
            source_id: Source agent ID
            extra_payload: Additional payload data (e.g., operation details)
        """
        # Build base payload
        base_payload = {
            "document": {
                "document_id": document.document_id,
                "name": document.name,
                "creator_agent_id": document.creator_agent_id,
                "created_timestamp": document.created_timestamp.isoformat(),
                "last_modified": document.last_modified.isoformat(),
                "version": document.version,
                "content": document.content,
                "active_users": document.active_users,
                "cursor_positions": document.cursor_positions,
                "last_editor": source_id,  # Add editor info
            }
        }

        # Merge extra payload if provided
        if extra_payload:
            base_payload.update(extra_payload)

        # If document has no access restrictions (public), broadcast to everyone
        if not document.access_permissions:
            notification = Event(
                event_name=event_name,
                destination_id=BROADCAST_AGENT_ID,
                source_id=source_id,
                payload=base_payload,
            )
            await self.send_event(notification)
            logger.info(f"Document notification (public): {event_name} for document {document.document_id}")
        else:
            # Document has access restrictions - only notify agents with permissions
            notified_agents = set()

            # Notify creator
            if document.creator_agent_id != source_id:
                notification = Event(
                    event_name=event_name,
                    destination_id=document.creator_agent_id,
                    source_id=source_id,
                    payload=base_payload,
                )
                await self.send_event(notification)
                notified_agents.add(document.creator_agent_id)

            # Notify agents with explicit permissions
            for agent_id in document.access_permissions.keys():
                if agent_id == source_id:
                    continue

                notification = Event(
                    event_name=event_name,
                    destination_id=agent_id,
                    source_id=source_id,
                    payload=base_payload,
                )
                await self.send_event(notification)
                notified_agents.add(agent_id)

            logger.info(
                f"Document notification (restricted): {event_name} for document {document.document_id} "
                f"sent to {len(notified_agents)} agents"
            )

    async def _broadcast_to_document_users(
        self,
        document_id: str,
        event_name: str,
        payload: Dict[str, Any],
        exclude_agent_id: Optional[str] = None,
    ):
        """Broadcast event to all users currently viewing a document.

        Args:
            document_id: Document ID
            event_name: Name of the event to broadcast
            payload: Event payload
            exclude_agent_id: Agent ID to exclude from broadcast (e.g., the sender)
        """
        if document_id not in self.documents:
            logger.warning(f"Cannot broadcast to document {document_id}: document not found")
            return

        document = self.documents[document_id]

        # Broadcast to all active users except the excluded agent
        for agent_id in document.active_users:
            if exclude_agent_id and agent_id == exclude_agent_id:
                continue

            notification = Event(
                event_name=event_name,
                destination_id=agent_id,
                source_id="mod:openagents.mods.workspace.documents",
                payload=payload,
            )
            await self.send_event(notification)

        logger.info(
            f"Broadcasted {event_name} to {len(document.active_users)} active users "
            f"(excluding {exclude_agent_id if exclude_agent_id else 'none'})"
        )


# Backward compatibility alias
SharedDocumentNetworkMod = DocumentsNetworkMod
SharedDocument = Document
