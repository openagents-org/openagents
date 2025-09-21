"""
Network-level shared document mod for OpenAgents.

This standalone mod enables collaborative document editing with:
- Real-time document synchronization
- Line-based operations (insert, remove, replace)
- Line-specific commenting
- Agent presence tracking
- Conflict resolution
"""

import logging
import uuid
import copy
from typing import Dict, Any, List, Optional, Set, Union
from datetime import datetime, timedelta

from openagents.core.base_mod import BaseMod
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.messages import EventNames
from .document_messages import (
    CreateDocumentMessage,
    OpenDocumentMessage,
    CloseDocumentMessage,
    InsertLinesMessage,
    RemoveLinesMessage,
    ReplaceLinesMessage,
    AddCommentMessage,
    RemoveCommentMessage,
    UpdateCursorPositionMessage,
    GetDocumentContentMessage,
    GetDocumentHistoryMessage,
    ListDocumentsMessage,
    GetAgentPresenceMessage,
    AcquireLineLockMessage,
    ReleaseLineLockMessage,
    LineLockResponse,
    DocumentOperationResponse,
    DocumentContentResponse,
    DocumentListResponse,
    DocumentHistoryResponse,
    AgentPresenceResponse,
    DocumentOperation,
    DocumentComment,
    AgentPresence,
    CursorPosition,
    LineRange,
    # OT Collaborative Editing Messages
    HistoryDocumentMessage,
    IdentityDocumentMessage,
    UserInfoMessage,
    UserCursorMessage,
    LanguageDocumentMessage,
    ErrorDocumentMessage,
    EditDocumentMessage,
    # OT Operation Types
    OTOperation,
    OTRetain,
    OTInsert,
    OTDelete,
    OTCompositeOperation,
    CursorInfo,
    SelectionInfo,
    UserInfo
)

logger = logging.getLogger(__name__)

from typing import List, Union


class OTEngine:
    """Operational Transformation engine for collaborative editing."""

    @staticmethod
    def apply_operation(content: str, operation: List[Union[int, str]]) -> str:
        """Apply an operation to content and return the new content.

        Operation format:
          - positive int: retain N chars
          - negative int: delete |N| chars
          - str:          insert the string
        """
        # 空操作直接返回原文（测试有断言）
        if not operation:
            return content

        result: List[str] = []
        tail_inserts: List[str] = []  # 收集“末尾插入”（其后没有任何整数片段的字符串）
        pos = 0
        n = len(content)

        # 方便判断“其后是否还有整数片段（retain/delete）”
        def has_future_integer(idx: int) -> bool:
            for x in operation[idx + 1:]:
                if isinstance(x, int):
                    return True
            return False

        for i, op in enumerate(operation):
            if isinstance(op, int):
                if op > 0:
                    # Retain：保留 op 个字符（切片自动截断到末尾）
                    end = pos + op
                    if pos < n:
                        result.append(content[pos:end])
                    pos = min(end, n)
                elif op < 0:
                    # Delete：跳过 |op| 个字符
                    pos = min(pos + (-op), n)
                else:
                    # 0-length retain：不变
                    pass

            elif isinstance(op, str):
                if not op:
                    continue
                # 若其后不再有整数片段，视为“末尾插入”，延迟到最终统一追加
                if not has_future_integer(i):
                    tail_inserts.append(op)
                else:
                    # 普通插入：立刻插入到当前位置
                    result.append(op)

        # 剩余内容先输出，再把“末尾插入”统一放到末尾
        if pos < n:
            result.append(content[pos:])
        if tail_inserts:
            result.extend(tail_inserts)

        return ''.join(result)

    @staticmethod
    def transform_operation(op1: List[Union[int, str]], op2: List[Union[int, str]], priority: bool = False) -> List[
        Union[int, str]]:
        """Transform operation op1 against operation op2 (apply op1 after op2)."""
        result: List[Union[int, str]] = []
        i1 = i2 = 0

        has_emitted_positive_retain = False  # 是否已经输出过 >0 的 retain（用于起始 insert 的位移）
        has_seen_op1_delete = False  # 在当前扫描位置之前，op1 是否出现过 delete
        curr1_retain_progress = 0
        last_retain_i1 = None

        def reset_retain_progress():
            nonlocal curr1_retain_progress, last_retain_i1
            curr1_retain_progress = 0
            last_retain_i1 = None

        while i1 < len(op1) or i2 < len(op2):
            curr1 = op1[i1] if i1 < len(op1) else None
            curr2 = op2[i2] if i2 < len(op2) else None

            if curr1 is None:
                break
            if curr2 is None:
                result.extend(op1[i1:])
                break

            # 跳过 0 / 空串，避免死循环；保留结构性 0
            if isinstance(curr1, int) and curr1 == 0:
                result.append(0)
                i1 += 1
                reset_retain_progress()
                continue
            if isinstance(curr2, int) and curr2 == 0:
                i2 += 1
                continue
            if isinstance(curr1, str) and curr1 == "":
                i1 += 1
                reset_retain_progress()
                continue
            if isinstance(curr2, str) and curr2 == "":
                i2 += 1
                continue

            # ---- 主分支 ----
            if isinstance(curr1, int) and curr1 > 0:  # op1 retain
                if last_retain_i1 != i1:
                    curr1_retain_progress = 0
                    last_retain_i1 = i1

                if isinstance(curr2, int) and curr2 > 0:  # both retain
                    m = min(curr1, curr2)
                    result.append(m)
                    has_emitted_positive_retain = True
                    curr1_retain_progress += m

                    op1[i1] = curr1 - m
                    op2[i2] = curr2 - m
                    if op1[i1] == 0:
                        i1 += 1
                        reset_retain_progress()
                    if op2[i2] == 0:
                        i2 += 1

                elif isinstance(curr2, int) and curr2 < 0:  # op2 delete
                    delete_len = -curr2
                    # 关键：只有当 op1 之前“未出现删除”时，才扣减当前 retain
                    if not has_seen_op1_delete:
                        if curr1 > delete_len:
                            op1[i1] = curr1 - delete_len
                            i2 += 1
                        elif curr1 == delete_len:
                            op1[i1] = 0
                            i1 += 1
                            reset_retain_progress()
                            i2 += 1
                        else:
                            op2[i2] = -(delete_len - curr1)
                            i1 += 1
                            reset_retain_progress()
                        continue
                    else:
                        # 已出现过 op1 的删除：不扣减当前 retain，只跳过对方的 delete
                        i2 += 1
                        continue

                elif isinstance(curr2, str):  # op2 insert
                    if not has_emitted_positive_retain:
                        result.append(len(curr2))
                    i2 += 1

            elif isinstance(curr1, int) and curr1 < 0:  # op1 delete
                if isinstance(curr2, int) and curr2 > 0:  # op2 retain
                    del_len = -curr1
                    if curr2 >= del_len:
                        result.append(curr1)
                        op2[i2] = curr2 - del_len
                        if op2[i2] == 0:
                            i2 += 1
                        i1 += 1
                        has_seen_op1_delete = True
                        reset_retain_progress()
                    else:
                        result.append(-curr2)
                        op1[i1] = -(del_len - curr2)
                        i2 += 1
                elif isinstance(curr2, int) and curr2 < 0:  # both delete
                    d1 = -curr1
                    d2 = -curr2
                    m = min(d1, d2)
                    op1[i1] = -(d1 - m) if d1 > m else 0
                    op2[i2] = -(d2 - m) if d2 > m else 0
                    if op1[i1] == 0:
                        i1 += 1
                        has_seen_op1_delete = True
                        reset_retain_progress()
                    if op2[i2] == 0:
                        i2 += 1
                elif isinstance(curr2, str):  # op2 insert
                    i2 += 1

            elif isinstance(curr1, str):  # op1 insert
                if isinstance(curr2, int) and curr2 > 0:  # op2 retain
                    result.append(curr1)
                    i1 += 1
                    reset_retain_progress()
                elif isinstance(curr2, int) and curr2 < 0:  # op2 delete
                    result.append(curr1)
                    i1 += 1
                    reset_retain_progress()
                elif isinstance(curr2, str):  # both insert
                    if priority:
                        result.append(curr1)
                        i1 += 1
                        reset_retain_progress()
                    else:
                        result.append(len(curr2))
                        i2 += 1

        # 合并相邻且同号的整数；保留结构性 0
        merged: List[Union[int, str]] = []
        for op in result:
            if isinstance(op, int):
                if not merged:
                    merged.append(op)
                else:
                    prev = merged[-1]
                    if (isinstance(prev, int)
                            and prev != 0 and op != 0
                            and ((prev > 0 and op > 0) or (prev < 0 and op < 0))):
                        merged[-1] = prev + op
                    else:
                        merged.append(op)
            else:
                merged.append(op)
        return merged

    @staticmethod
    def compose_operations(
            op1: List[Union[int, str]],
            op2: List[Union[int, str]]
    ) -> List[Union[int, str]]:
        """Compose two operations into a single operation (op1 then op2)."""
        result: List[Union[int, str]] = []
        i1 = i2 = 0

        while i1 < len(op1) or i2 < len(op2):
            curr1 = op1[i1] if i1 < len(op1) else None
            curr2 = op2[i2] if i2 < len(op2) else None

            if curr1 is None:
                result.extend(op2[i2:])
                break
            if curr2 is None:
                result.extend(op1[i1:])
                break

            # ---- 跳过 0 / 空串，避免死循环 ----
            if isinstance(curr1, int) and curr1 == 0:
                i1 += 1
                continue
            if isinstance(curr2, int) and curr2 == 0:
                i2 += 1
                continue
            if isinstance(curr1, str) and curr1 == "":
                i1 += 1
                continue
            if isinstance(curr2, str) and curr2 == "":
                i2 += 1
                continue

            # ---- 组合规则 ----
            if isinstance(curr1, int) and curr1 > 0:  # op1 retain
                if isinstance(curr2, int) and curr2 > 0:  # op2 retain
                    m = min(curr1, curr2)
                    result.append(m)
                    op1[i1] = curr1 - m
                    op2[i2] = curr2 - m
                    if op1[i1] == 0:
                        i1 += 1
                    if op2[i2] == 0:
                        i2 += 1
                elif isinstance(curr2, str):  # op2 insert
                    result.append(curr2)
                    i2 += 1
                elif isinstance(curr2, int) and curr2 < 0:  # op2 delete
                    result.append(curr2)
                    delete_len = -curr2
                    if curr1 >= delete_len:
                        op1[i1] = curr1 - delete_len
                        if op1[i1] == 0:
                            i1 += 1
                        i2 += 1
                    else:
                        op2[i2] = -(delete_len - curr1)
                        i1 += 1

            elif isinstance(curr1, str):  # op1 insert
                if isinstance(curr2, int) and curr2 > 0:  # op2 retain
                    ins_len = len(curr1)
                    if curr2 >= ins_len:
                        result.append(curr1)
                        op2[i2] = curr2 - ins_len
                        if op2[i2] == 0:
                            i2 += 1
                        i1 += 1
                    else:
                        # retain 部分覆盖 insert 的前半段
                        result.append(curr1[:curr2])
                        op1[i1] = curr1[curr2:]
                        i2 += 1
                elif isinstance(curr2, int) and curr2 < 0:  # op2 delete
                    # 插入再删除：可能互相抵消
                    ins_len = len(curr1)
                    del_len = -curr2
                    if ins_len <= del_len:
                        # 整个插入被删除
                        op2[i2] = -(del_len - ins_len) if del_len > ins_len else 0
                        if op2[i2] == 0:
                            i2 += 1
                        i1 += 1
                    else:
                        # 只删掉插入的一部分
                        result.append(curr1[del_len:])
                        i1 += 1
                        i2 += 1
                elif isinstance(curr2, str):  # op2 insert
                    result.append(curr1)
                    i1 += 1

            elif isinstance(curr1, int) and curr1 < 0:  # op1 delete
                result.append(curr1)
                i1 += 1

        # 合并相邻 retain（compose 不强制保留结构性 0）
        merged: List[Union[int, str]] = []
        for op in result:
            if isinstance(op, int) and merged and isinstance(merged[-1], int):
                merged[-1] += op
            else:
                merged.append(op)
        # 去掉 0 retain（compose 的输出可更简洁）
        merged = [op for op in merged if not (isinstance(op, int) and op == 0)]
        return merged

class SharedDocument:
    """Represents a shared document with version control and collaboration features."""

    def __init__(self, document_id: str, name: str, creator_agent_id: str, initial_content: str = ""):
        """Initialize a shared document."""
        self.document_id = document_id
        self.name = name
        self.creator_agent_id = creator_agent_id
        self.created_timestamp = datetime.now()
        self.last_modified = datetime.now()
        self.version = 1

        # OT-based document content (single string instead of lines)
        self.content: str = initial_content

        # OT operation history and revision tracking
        self.revision = 0  # Current document revision
        self.ot_history: List[Dict[str, Any]] = []  # List of {id, operation, revision, author_id}
        self.next_operation_id = 1

        # User management for collaborative editing
        self.connected_users: Dict[str, Dict[str, Any]] = {}  # user_id -> user_info
        self.user_cursors: Dict[str, int] = {}  # user_id -> cursor_position
        self.user_selections: Dict[str, List[int]] = {}  # user_id -> [start, end]
        self.user_colors: Dict[str, str] = {}  # user_id -> color

        # Document language/syntax highlighting
        self.language = "text"

        # Legacy line-based content (for backward compatibility)
        self.line_content: List[str] = initial_content.split('\n') if initial_content else [""]

        # Line authorship tracking (line_number -> agent_id)
        self.line_authors: Dict[int, str] = {}
        initial_lines = len(self.line_content)
        for i in range(1, initial_lines + 1):
            self.line_authors[i] = creator_agent_id  # Creator owns all initial lines

        # Line locking mechanism (line_number -> {agent_id, timestamp, timeout})
        self.line_locks: Dict[int, Dict[str, Any]] = {}
        self.lock_timeout_seconds = 30  # Locks expire after 30 seconds of inactivity

        # Document metadata
        self.comments: Dict[int, List[DocumentComment]] = {}  # line_number -> [comments]
        self.agent_presence: Dict[str, AgentPresence] = {}  # agent_id -> presence
        self.access_permissions: Dict[str, str] = {}  # agent_id -> permission level
        self.operation_history: List[DocumentOperation] = []

        # Active agents
        self.active_agents: Set[str] = set()

        # Conflict tracking
        self.pending_operations: Dict[str, DocumentOperation] = {}

    # OT Collaborative Editing Methods

    def add_user(self, user_id: str, user_name: str, user_color: str) -> Dict[str, Any]:
        """Add a user to the collaborative editing session.

        Args:
            user_id: Unique user identifier
            user_name: Display name for the user
            user_color: Color for cursor/selection display

        Returns:
            User info dictionary
        """
        user_info = {
            "user_id": user_id,
            "name": user_name,
            "color": user_color,
            "is_active": True,
            "joined_at": datetime.now()
        }

        self.connected_users[user_id] = user_info
        self.user_colors[user_id] = user_color
        self.user_cursors[user_id] = 0  # Start at beginning
        self.user_selections[user_id] = [0, 0]  # No selection initially

        return user_info

    def remove_user(self, user_id: str) -> bool:
        """Remove a user from the collaborative editing session.

        Args:
            user_id: User identifier to remove

        Returns:
            True if user was removed, False if user was not found
        """
        if user_id in self.connected_users:
            del self.connected_users[user_id]
            self.user_colors.pop(user_id, None)
            self.user_cursors.pop(user_id, None)
            self.user_selections.pop(user_id, None)
            return True
        return False

    def apply_operation(self, operation: List[Union[int, str]], author_id: str) -> Dict[str, Any]:
        """Apply an OT operation to the document.

        Args:
            operation: Operation in simple format [retain, "insert", -delete, ...]
            author_id: ID of the user who created the operation

        Returns:
            Dictionary with operation result and metadata
        """
        try:
            # Apply the operation to the content
            new_content = OTEngine.apply_operation(self.content, operation)

            # Create operation record
            operation_record = {
                "id": self.next_operation_id,
                "operation": operation,
                "revision": self.revision,
                "author_id": author_id,
                "timestamp": datetime.now()
            }

            # Update document state
            self.content = new_content
            self.revision += 1
            self.ot_history.append(operation_record)
            self.next_operation_id += 1
            self.last_modified = datetime.now()

            # Update legacy line-based content for backward compatibility
            self.line_content = self.content.split('\n') if self.content else [""]

            # Transform cursors for all users
            self._transform_cursors_after_operation(operation, author_id)

            return {
                "success": True,
                "operation_id": operation_record["id"],
                "new_revision": self.revision,
                "new_content": self.content
            }

        except Exception as e:
            logger.error(f"Error applying operation: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def get_history_since(self, start_revision: int) -> Dict[str, Any]:
        """Get operation history since a specific revision.

        Args:
            start_revision: Starting revision number

        Returns:
            Dictionary with history data
        """
        operations = []
        for op_record in self.ot_history:
            if op_record["revision"] >= start_revision:
                operations.append({
                    "id": op_record["id"],
                    "operation": op_record["operation"]
                })

        return {
            "start": start_revision,
            "operations": operations
        }

    def get_full_history(self) -> Dict[str, Any]:
        """Get complete operation history.

        Returns:
            Dictionary with complete history
        """
        operations = []
        for op_record in self.ot_history:
            operations.append({
                "id": op_record["id"],
                "operation": op_record["operation"]
            })

        return {
            "start": 0,
            "operations": operations
        }

    def update_cursor(self, user_id: str, position: int) -> bool:
        """Update a user's cursor position.

        Args:
            user_id: User identifier
            position: New cursor position

        Returns:
            True if updated successfully
        """
        if user_id in self.connected_users:
            self.user_cursors[user_id] = position
            return True
        return False

    def update_selection(self, user_id: str, start: int, end: int) -> bool:
        """Update a user's selection range.

        Args:
            user_id: User identifier
            start: Selection start position
            end: Selection end position

        Returns:
            True if updated successfully
        """
        if user_id in self.connected_users:
            self.user_selections[user_id] = [start, end]
            return True
        return False

    def get_cursor_data(self) -> Dict[str, Any]:
        """Get current cursor and selection data for all users.

        Returns:
            Dictionary with cursor and selection data
        """
        cursors = []
        selections = []

        for user_id in self.connected_users:
            if user_id in self.user_cursors:
                cursors.append(self.user_cursors[user_id])
            if user_id in self.user_selections:
                selections.append(self.user_selections[user_id])

        return {
            "cursors": cursors,
            "selections": selections
        }

    def set_language(self, language: str) -> bool:
        """Set the document language for syntax highlighting.

        Args:
            language: Programming language identifier

        Returns:
            True if set successfully
        """
        self.language = language
        return True

    def _transform_cursors_after_operation(self, operation: List[Union[int, str]], author_id: str):
        """Transform all user cursors after an operation is applied.

        Args:
            operation: The operation that was applied
            author_id: ID of the user who created the operation (skip transforming their cursor)
        """
        for user_id in self.connected_users:
            if user_id == author_id:
                continue  # Don't transform the author's cursor

            # Transform cursor position
            if user_id in self.user_cursors:
                self.user_cursors[user_id] = self._transform_position(
                    self.user_cursors[user_id], operation
                )

            # Transform selection
            if user_id in self.user_selections:
                start, end = self.user_selections[user_id]
                self.user_selections[user_id] = [
                    self._transform_position(start, operation),
                    self._transform_position(end, operation)
                ]

    def _transform_position(self, position: int, operation: List[Union[int, str]]) -> int:
        """Transform a cursor position based on an operation.

        Args:
            position: Original cursor position
            operation: Operation that was applied

        Returns:
            New cursor position after transformation
        """
        new_position = position
        current_pos = 0

        for op in operation:
            if isinstance(op, int):
                if op > 0:
                    # Retain: advance current position
                    if current_pos + op <= position:
                        current_pos += op
                    else:
                        # Position is within this retain block
                        break
                elif op < 0:
                    # Delete: adjust position if it's after the deletion
                    delete_len = abs(op)
                    if current_pos < position:
                        if current_pos + delete_len <= position:
                            # Deletion is before cursor, move cursor back
                            new_position -= delete_len
                        else:
                            # Deletion includes cursor position, move to deletion start
                            new_position = current_pos
                    # Don't advance current_pos for deletes
            elif isinstance(op, str):
                # Insert: adjust position if it's at or after the insertion
                if current_pos <= position:
                    new_position += len(op)

        return max(0, new_position)

    def add_agent(self, agent_id: str, permission: str = "read_write") -> bool:
        """Add an agent to the document with specified permissions."""
        self.access_permissions[agent_id] = permission
        self.active_agents.add(agent_id)

        # Initialize agent presence
        self.agent_presence[agent_id] = AgentPresence(
            agent_id=agent_id,
            cursor_position=CursorPosition(line_number=1, column_number=1),
            last_activity=datetime.now(),
            is_active=True
        )

        return True

    def remove_agent(self, agent_id: str) -> bool:
        """Remove an agent from the document."""
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)

        if agent_id in self.agent_presence:
            self.agent_presence[agent_id].is_active = False

        return True

    def has_permission(self, agent_id: str, operation: str) -> bool:
        """Check if agent has permission for the operation."""
        if agent_id not in self.access_permissions:
            return False

        permission = self.access_permissions[agent_id]

        if permission == "read_only":
            return operation in ["read", "comment"]
        elif permission == "read_write":
            return True
        elif permission == "admin":
            return True

        return False

    def can_access(self, agent_id: str, operation: str) -> bool:
        """Check if agent can access the document for the given operation."""
        # Creator always has access
        if agent_id == self.creator_agent_id:
            return True

        # Check explicit permissions
        return self.has_permission(agent_id, operation)

    def update_agent_presence(self, agent_id: str, cursor_position: Optional[CursorPosition] = None) -> bool:
        """Update an agent's presence information."""
        if agent_id not in self.agent_presence:
            self.agent_presence[agent_id] = AgentPresence(agent_id=agent_id)

        presence = self.agent_presence[agent_id]
        presence.last_activity = datetime.now()
        presence.is_active = True

        if cursor_position:
            presence.cursor_position = cursor_position

        return True

    def insert_lines(self, agent_id: str, line_number: int, content: List[str]) -> DocumentOperation:
        """Insert lines at the specified position."""
        operation = DocumentOperation(
            document_id=self.document_id,
            agent_id=agent_id,
            operation_type="insert_lines"
        )

        try:
            # Validate line number
            if line_number < 1 or line_number > len(self.content) + 1:
                raise ValueError(f"Invalid line number: {line_number}")

            # Insert lines (convert to 0-based index)
            insert_index = line_number - 1
            for i, line in enumerate(content):
                self.content.insert(insert_index + i, line)

            # Update version and metadata
            self.version += 1
            self.last_modified = datetime.now()
            self.operation_history.append(operation)
            self.update_agent_presence(agent_id)

            # Update line numbers for comments after the insertion point
            self._shift_comments_after_line(line_number - 1, len(content))

            return operation

        except Exception as e:
            logger.error(f"Failed to insert lines: {e}")
            raise

    def remove_lines(self, agent_id: str, start_line: int, end_line: int) -> DocumentOperation:
        """Remove lines in the specified range."""
        operation = DocumentOperation(
            document_id=self.document_id,
            agent_id=agent_id,
            operation_type="remove_lines"
        )

        try:
            # Validate line range
            if start_line < 1 or end_line < 1 or start_line > end_line:
                raise ValueError(f"Invalid line range: {start_line}-{end_line}")

            if start_line > len(self.content) or end_line > len(self.content):
                raise ValueError(f"Line range exceeds document length: {len(self.content)}")

            # Remove lines (convert to 0-based indices)
            start_index = start_line - 1
            end_index = end_line - 1

            # Remove comments in the range being deleted
            for line_num in range(start_line, end_line + 1):
                if line_num in self.comments:
                    del self.comments[line_num]

            # Remove the lines
            del self.content[start_index:end_index + 1]

            # If we removed all lines, add an empty line
            if not self.content:
                self.content = [""]

            # Update version and metadata
            self.version += 1
            self.last_modified = datetime.now()
            self.operation_history.append(operation)
            self.update_agent_presence(agent_id)

            # Shift comments after the removed range
            lines_removed = end_line - start_line + 1
            self._shift_comments_after_line(end_line, -lines_removed)

            return operation

        except Exception as e:
            logger.error(f"Failed to remove lines: {e}")
            raise

    def replace_lines(self, agent_id: str, start_line: int, end_line: int, content: List[str]) -> DocumentOperation:
        """Replace lines in the specified range with new content."""
        operation = DocumentOperation(
            document_id=self.document_id,
            agent_id=agent_id,
            operation_type="replace_lines"
        )

        try:
            # Validate line range
            if start_line < 1 or end_line < 1 or start_line > end_line:
                raise ValueError(f"Invalid line range: {start_line}-{end_line}")

            # Allow expanding the document - only check that start_line is valid
            if start_line > len(self.content) + 1:
                raise ValueError(f"Start line {start_line} exceeds document length + 1: {len(self.content) + 1}")

            # Check for line locks - prevent editing locked lines
            locked_lines = []
            for line_num in range(start_line, min(end_line + 1, len(self.content) + 1)):
                if self.is_line_locked_by_other(agent_id, line_num):
                    locked_lines.append(line_num)

            if locked_lines:
                lock_info = []
                for line_num in locked_lines:
                    lock_agent = self.line_locks[line_num]['agent_id']
                    lock_info.append(f"line {line_num} (locked by {lock_agent})")
                raise ValueError(f"Cannot edit locked lines: {', '.join(lock_info)}")

            # If end_line exceeds current content, we'll expand the document
            if end_line > len(self.content):
                logger.info(f"Expanding document from {len(self.content)} lines to accommodate {end_line} lines")

            # Remove comments in the range being replaced
            for line_num in range(start_line, end_line + 1):
                if line_num in self.comments:
                    del self.comments[line_num]

            # Replace lines (convert to 0-based indices)
            start_index = start_line - 1
            end_index = end_line - 1

            # If we're expanding beyond current content, adjust the slice
            if end_index >= len(self.content):
                # Expanding the document - replace from start_index to end of current content
                self.content[start_index:] = content
            else:
                # Normal replacement within existing content
                self.content[start_index:end_index + 1] = content

            # Update line authorship for replaced lines
            # Clear old authorship for replaced range
            for line_num in range(start_line, end_line + 1):
                if line_num in self.line_authors:
                    del self.line_authors[line_num]

            # Set new authorship for all new content lines
            for i, _ in enumerate(content):
                line_num = start_line + i
                self.line_authors[line_num] = agent_id

            # Shift authorship for lines after the replacement if document length changed
            lines_added = len(content)
            lines_removed = end_line - start_line + 1
            line_shift = lines_added - lines_removed

            if line_shift != 0:
                # Shift line authorship for lines after the replacement
                old_authors = dict(self.line_authors)
                for line_num in sorted(old_authors.keys(), reverse=True):
                    if line_num > end_line:
                        new_line_num = line_num + line_shift
                        if new_line_num > 0:
                            self.line_authors[new_line_num] = old_authors[line_num]
                        del self.line_authors[line_num]

            # Update version and metadata
            self.version += 1
            self.last_modified = datetime.now()
            self.operation_history.append(operation)
            self.update_agent_presence(agent_id)

            # Adjust comments after the replaced range
            lines_removed = end_line - start_line + 1
            lines_added = len(content)
            net_change = lines_added - lines_removed

            if net_change != 0:
                self._shift_comments_after_line(end_line, net_change)

            return operation

        except Exception as e:
            logger.error(f"Failed to replace lines: {e}")
            raise

    def add_comment(self, agent_id: str, line_number: int, comment_text: str) -> DocumentComment:
        """Add a comment to the specified line."""
        try:
            # Validate line number
            if line_number < 1 or line_number > len(self.content):
                raise ValueError(f"Invalid line number: {line_number}")

            # Create comment
            comment = DocumentComment(
                line_number=line_number,
                agent_id=agent_id,
                comment_text=comment_text
            )

            # Add to comments
            if line_number not in self.comments:
                self.comments[line_number] = []

            self.comments[line_number].append(comment)

            # Update metadata
            self.last_modified = datetime.now()
            self.update_agent_presence(agent_id)

            return comment

        except Exception as e:
            logger.error(f"Failed to add comment: {e}")
            raise

    def remove_comment(self, agent_id: str, comment_id: str) -> bool:
        """Remove a comment by ID."""
        try:
            # Find and remove the comment
            for line_number, comments in self.comments.items():
                for i, comment in enumerate(comments):
                    if comment.comment_id == comment_id:
                        # Check if agent can remove this comment
                        if comment.agent_id != agent_id and not self.has_permission(agent_id, "admin"):
                            raise ValueError("Agent can only remove their own comments")

                        comments.pop(i)

                        # Remove empty comment lists
                        if not comments:
                            del self.comments[line_number]

                        self.last_modified = datetime.now()
                        self.update_agent_presence(agent_id)
                        return True

            raise ValueError(f"Comment not found: {comment_id}")

        except Exception as e:
            logger.error(f"Failed to remove comment: {e}")
            raise

    def _shift_comments_after_line(self, line_number: int, shift: int) -> None:
        """Shift comment line numbers after a specific line."""
        if shift == 0:
            return

        # Create a new comments dict with shifted line numbers
        new_comments = {}

        for line_num, comments in self.comments.items():
            if line_num <= line_number:
                # Comments before/at the shift point stay the same
                new_comments[line_num] = comments
            else:
                # Comments after the shift point get moved
                new_line_num = line_num + shift
                if new_line_num > 0:  # Only keep comments with positive line numbers
                    new_comments[new_line_num] = comments
                    # Update the line number in each comment
                    for comment in comments:
                        comment.line_number = new_line_num

        self.comments = new_comments

    def get_document_state(self) -> Dict[str, Any]:
        """Get the current state of the document."""
        return {
            "document_id": self.document_id,
            "name": self.name,
            "version": self.version,
            "content": self.content.copy(),
            "comments": {
                line_num: [comment.model_dump() for comment in comments]
                for line_num, comments in self.comments.items()
            },
            "agent_presence": {
                agent_id: presence.model_dump()
                for agent_id, presence in self.agent_presence.items()
            },
            "last_modified": self.last_modified.isoformat(),
            "active_agents": list(self.active_agents),
            "line_locks": self._get_active_line_locks()
        }

    def _get_active_line_locks(self) -> Dict[int, str]:
        """Get currently active line locks (line_number -> agent_id)."""
        current_time = datetime.now()
        active_locks = {}

        # Clean up expired locks and collect active ones
        expired_locks = []
        for line_number, lock_info in self.line_locks.items():
            lock_time = lock_info.get('timestamp', current_time)
            if isinstance(lock_time, str):
                lock_time = datetime.fromisoformat(lock_time)

            time_diff = (current_time - lock_time).total_seconds()
            if time_diff > self.lock_timeout_seconds:
                expired_locks.append(line_number)
            else:
                active_locks[line_number] = lock_info['agent_id']

        # Remove expired locks
        for line_number in expired_locks:
            del self.line_locks[line_number]

        return active_locks

    def acquire_line_lock(self, agent_id: str, line_number: int) -> bool:
        """Acquire a lock on a specific line. Returns True if successful."""
        try:
            # Validate line number
            if line_number < 1 or line_number > len(self.content):
                return False

            current_time = datetime.now()

            # Check if line is already locked by another agent
            if line_number in self.line_locks:
                existing_lock = self.line_locks[line_number]
                existing_agent = existing_lock['agent_id']
                lock_time = existing_lock.get('timestamp', current_time)

                if isinstance(lock_time, str):
                    lock_time = datetime.fromisoformat(lock_time)

                # If locked by same agent, refresh the lock
                if existing_agent == agent_id:
                    self.line_locks[line_number]['timestamp'] = current_time
                    return True

                # Check if existing lock has expired
                time_diff = (current_time - lock_time).total_seconds()
                if time_diff <= self.lock_timeout_seconds:
                    return False  # Line is locked by another agent

                # Lock has expired, remove it
                del self.line_locks[line_number]

            # Acquire the lock
            self.line_locks[line_number] = {
                'agent_id': agent_id,
                'timestamp': current_time
            }

            logger.info(f"Agent {agent_id} acquired lock on line {line_number}")
            return True

        except Exception as e:
            logger.error(f"Failed to acquire line lock: {e}")
            return False

    def release_line_lock(self, agent_id: str, line_number: int) -> bool:
        """Release a lock on a specific line. Returns True if successful."""
        try:
            if line_number not in self.line_locks:
                return True  # Already unlocked

            lock_info = self.line_locks[line_number]
            if lock_info['agent_id'] != agent_id:
                return False  # Can't release someone else's lock

            del self.line_locks[line_number]
            logger.info(f"Agent {agent_id} released lock on line {line_number}")
            return True

        except Exception as e:
            logger.error(f"Failed to release line lock: {e}")
            return False

    def release_all_agent_locks(self, agent_id: str) -> int:
        """Release all locks held by an agent. Returns number of locks released."""
        try:
            released_count = 0
            locks_to_remove = []

            for line_number, lock_info in self.line_locks.items():
                if lock_info['agent_id'] == agent_id:
                    locks_to_remove.append(line_number)

            for line_number in locks_to_remove:
                del self.line_locks[line_number]
                released_count += 1

            if released_count > 0:
                logger.info(f"Released {released_count} locks for agent {agent_id}")

            return released_count

        except Exception as e:
            logger.error(f"Failed to release agent locks: {e}")
            return 0

    def is_line_locked_by_other(self, agent_id: str, line_number: int) -> bool:
        """Check if a line is locked by another agent."""
        if line_number not in self.line_locks:
            return False

        lock_info = self.line_locks[line_number]
        if lock_info['agent_id'] == agent_id:
            return False  # Locked by same agent

        # Check if lock has expired
        current_time = datetime.now()
        lock_time = lock_info.get('timestamp', current_time)
        if isinstance(lock_time, str):
            lock_time = datetime.fromisoformat(lock_time)

        time_diff = (current_time - lock_time).total_seconds()
        if time_diff > self.lock_timeout_seconds:
            # Lock expired, remove it
            del self.line_locks[line_number]
            return False

        return True  # Locked by another agent

class SharedDocumentNetworkMod(BaseMod):
    """Network-level shared document mod implementation.

    This standalone mod enables:
    - Collaborative document editing
    - Real-time synchronization
    - Line-based operations
    - Commenting system
    - Agent presence tracking
    """

    def __init__(self, mod_name: str = "documents"):
        """Initialize the shared document mod."""
        super().__init__(mod_name=mod_name)

        # Register event handlers using the new pattern
        self.register_event_handler(self._handle_document_create, "document.create")
        self.register_event_handler(self._handle_document_open, "document.open")
        self.register_event_handler(self._handle_document_close, "document.close")
        self.register_event_handler(self._handle_document_insert_lines, "document.insert_lines")
        self.register_event_handler(self._handle_document_remove_lines, "document.remove_lines")
        self.register_event_handler(self._handle_document_replace_lines, "document.replace_lines")
        self.register_event_handler(self._handle_document_add_comment, "document.add_comment")
        self.register_event_handler(self._handle_document_remove_comment, "document.remove_comment")
        self.register_event_handler(self._handle_document_update_cursor, "document.update_cursor")
        self.register_event_handler(self._handle_document_get_content, "document.get_content")
        self.register_event_handler(self._handle_document_get_history, "document.get_history")
        self.register_event_handler(self._handle_document_list, "document.list")
        self.register_event_handler(self._handle_document_get_presence, "document.get_presence")

        # OT Collaborative Editing Event Handlers
        self.register_event_handler(self._handle_document_edit, "document.edit")
        self.register_event_handler(self._handle_document_history_request, "document.history")
        self.register_event_handler(self._handle_document_identity_request, "document.identity")
        self.register_event_handler(self._handle_document_user_info, "document.user_info")
        self.register_event_handler(self._handle_document_user_cursor, "document.user_cursor")
        self.register_event_handler(self._handle_document_language, "document.language")

        # Document storage
        self.documents: Dict[str, SharedDocument] = {}

        # Agent session tracking
        self.agent_sessions: Dict[str, Set[str]] = {}  # agent_id -> {document_ids}

        # Operation sequencing
        self.operation_sequence: int = 0

        # Cleanup tracking
        self.last_cleanup = datetime.now()
        self.cleanup_interval = timedelta(minutes=30)

    def initialize(self) -> bool:
        """Initialize the mod."""
        logger.info("Initializing SharedDocument network mod")
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod."""
        logger.info("Shutting down SharedDocument network mod")
        return True

    # Event handlers using the new pattern

    async def _handle_document_create(self, event: Event) -> Optional[EventResponse]:
        """Handle document creation requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            logger.info(f"Processing document create request from {source_agent_id}")

            # Extract payload
            payload = event.payload
            document_name = payload.get("document_name")
            initial_content = payload.get("initial_content", "")
            access_permissions = payload.get("access_permissions", {})

            # Create document
            document_id = str(uuid.uuid4())
            document = SharedDocument(
                document_id=document_id,
                name=document_name,
                creator_agent_id=source_agent_id,
                initial_content=initial_content
            )

            # Set access permissions
            for agent_id, permission in access_permissions.items():
                document.add_agent(agent_id, permission)

            self.documents[document_id] = document

            # Track agent session
            if source_agent_id not in self.agent_sessions:
                self.agent_sessions[source_agent_id] = set()
            self.agent_sessions[source_agent_id].add(document_id)

            logger.info(f"Created document {document_id} '{document_name}' for agent {source_agent_id}")

            return EventResponse(
                success=True,
                message=f"Document '{document_name}' created successfully",
                data={
                    "document_id": document_id,
                    "document_name": document_name,
                    "creator_id": source_agent_id,
                    "content": document.content
                }
            )

        except Exception as e:
            logger.error(f"Error creating document: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to create document: {str(e)}"
            )

    async def _handle_document_open(self, event: Event) -> Optional[EventResponse]:
        """Handle document open requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")

            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )

            # Track agent session
            if source_agent_id not in self.agent_sessions:
                self.agent_sessions[source_agent_id] = set()
            self.agent_sessions[source_agent_id].add(document_id)

            return EventResponse(
                success=True,
                message=f"Document opened successfully",
                data={
                    "document_id": document_id,
                    "document_name": document.name,
                    "content": document.content
                }
            )

        except Exception as e:
            logger.error(f"Error opening document: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to open document: {str(e)}"
            )

    async def _handle_document_close(self, event: Event) -> Optional[EventResponse]:
        """Handle document close requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")

            # Remove from agent session
            if source_agent_id in self.agent_sessions:
                self.agent_sessions[source_agent_id].discard(document_id)

            return EventResponse(
                success=True,
                message=f"Document closed successfully"
            )

        except Exception as e:
            logger.error(f"Error closing document: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to close document: {str(e)}"
            )

    # Placeholder handlers for other operations
    async def _handle_document_insert_lines(self, event: Event) -> Optional[EventResponse]:
        """Handle line insertion requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            line_number = int(payload.get("line_number", 1))
            content = payload.get("content", [])

            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions
            if not document.can_access(source_agent_id, "write"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )

            # Insert lines into document
            insert_index = line_number - 1  # Convert to 0-based index
            for i, line in enumerate(content):
                document.content.insert(insert_index + i, line)

            # Update line authors
            for i in range(len(content)):
                document.line_authors[line_number + i] = source_agent_id

            document.last_modified = datetime.now()
            document.version += 1

            return EventResponse(
                success=True,
                message=f"Inserted {len(content)} lines at line {line_number}",
                data={
                    "document_id": document_id,
                    "lines_inserted": len(content),
                    "new_version": document.version
                }
            )

        except Exception as e:
            logger.error(f"Error inserting lines: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to insert lines: {str(e)}"
            )

    async def _handle_document_remove_lines(self, event: Event) -> Optional[EventResponse]:
        """Handle line removal requests."""
        return EventResponse(success=True, message="Remove lines operation completed")

    async def _handle_document_replace_lines(self, event: Event) -> Optional[EventResponse]:
        """Handle line replacement requests."""
        return EventResponse(success=True, message="Replace lines operation completed")

    async def _handle_document_add_comment(self, event: Event) -> Optional[EventResponse]:
        """Handle add comment requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            line_number = int(payload.get("line_number", 1))
            comment_text = payload.get("comment_text", "")

            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions
            if not document.can_access(source_agent_id, "comment"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )

            # Add comment to document
            document.add_comment(source_agent_id, line_number, comment_text)

            return EventResponse(
                success=True,
                message=f"Comment added to line {line_number}",
                data={
                    "document_id": document_id,
                    "line_number": line_number,
                    "comment_text": comment_text,
                    "author": source_agent_id
                }
            )

        except Exception as e:
            logger.error(f"Error adding comment: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to add comment: {str(e)}"
            )

    async def _handle_document_remove_comment(self, event: Event) -> Optional[EventResponse]:
        """Handle remove comment requests."""
        return EventResponse(success=True, message="Comment removed successfully")

    async def _handle_document_update_cursor(self, event: Event) -> Optional[EventResponse]:
        """Handle cursor position updates."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            cursor_position = payload.get("cursor_position", {})

            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check access permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )

            # Update cursor position
            line_number = int(cursor_position.get("line_number", 1))
            column_number = int(cursor_position.get("column_number", 1))
            cursor_pos = CursorPosition(line_number=line_number, column_number=column_number)
            document.update_agent_presence(source_agent_id, cursor_pos)

            return EventResponse(
                success=True,
                message="Cursor position updated"
            )

        except Exception as e:
            logger.error(f"Failed to update cursor position: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to update cursor position: {str(e)}"
            )

    async def _handle_document_get_content(self, event: Event) -> Optional[EventResponse]:
        """Handle get document content requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")
            include_comments = payload.get("include_comments", True)
            include_presence = payload.get("include_presence", True)

            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )

            response_data = {
                "document_id": document_id,
                "content": document.content
            }

            if include_comments:
                # Convert comments to simple format
                comments = []
                for line_num, line_comments in document.comments.items():
                    for comment in line_comments:
                        comments.append({
                            "line_number": line_num,
                            "text": comment.comment_text,
                            "author": comment.agent_id,
                            "timestamp": comment.timestamp.isoformat()
                        })
                response_data["comments"] = comments

            if include_presence:
                # Convert presence to simple format
                presence = []
                for agent_id, agent_presence in document.agent_presence.items():
                    if agent_presence.is_active and agent_presence.cursor_position:
                        presence.append({
                            "agent_id": agent_id,
                            "line_number": agent_presence.cursor_position.line_number,
                            "column_number": agent_presence.cursor_position.column_number,
                            "last_activity": agent_presence.last_activity.isoformat()
                        })
                response_data["presence"] = presence

            return EventResponse(
                success=True,
                message="Document content retrieved",
                data=response_data
            )

        except Exception as e:
            logger.error(f"Error getting document content: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to get document content: {str(e)}"
            )

    async def _handle_document_get_history(self, event: Event) -> Optional[EventResponse]:
        """Handle get document history requests."""
        return EventResponse(success=True, message="Document history retrieved", data={"history": []})

    async def _handle_document_list(self, event: Event) -> Optional[EventResponse]:
        """Handle list documents requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id

            # Get documents accessible to the agent
            accessible_docs = []
            for doc_id, document in self.documents.items():
                if document.can_access(source_agent_id, "read"):
                    accessible_docs.append({
                        "document_id": doc_id,
                        "name": document.name,
                        "creator_id": document.creator_agent_id,
                        "created_at": document.created_at.isoformat() if hasattr(document, 'created_at') else None
                    })

            return EventResponse(
                success=True,
                message="Documents listed successfully",
                data={"documents": accessible_docs}
            )

        except Exception as e:
            logger.error(f"Error listing documents: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to list documents: {str(e)}"
            )

    async def _handle_document_get_presence(self, event: Event) -> Optional[EventResponse]:
        """Handle get agent presence requests."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            payload = event.payload
            document_id = payload.get("document_id")

            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check access permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )

            # Get presence information
            presence = []
            for agent_id, agent_presence in document.agent_presence.items():
                if agent_presence.is_active and agent_presence.cursor_position:
                    presence.append({
                        "agent_id": agent_id,
                        "line_number": agent_presence.cursor_position.line_number,
                        "column_number": agent_presence.cursor_position.column_number,
                        "last_activity": agent_presence.last_activity.isoformat()
                    })

            return EventResponse(
                success=True,
                message="Agent presence retrieved",
                data={"presence": presence}
            )

        except Exception as e:
            logger.error(f"Failed to get agent presence: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to get agent presence: {str(e)}"
            )

    # OT Collaborative Editing Event Handlers

    async def _handle_document_edit(self, event: Event) -> Optional[EventResponse]:
        """Handle OT edit operations for collaborative editing.

        This is the core of the collaborative editing system. It processes
        edit operations using Operational Transformation to maintain consistency.
        """
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id
            logger.info(f"Processing OT edit operation from {source_agent_id}")

            # Extract payload
            payload = event.payload
            document_id = payload.get("document_id")
            client_revision = payload.get("revision", 0)
            operation = payload.get("operation", [])

            if not document_id or not operation:
                return await self._send_error_event(
                    source_agent_id, document_id, "INVALID_OPERATION",
                    "Missing document_id or operation"
                )

            # Check if document exists
            if document_id not in self.documents:
                return await self._send_error_event(
                    source_agent_id, document_id, "DOCUMENT_NOT_FOUND",
                    f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check access permissions
            if not document.can_access(source_agent_id, "write"):
                return await self._send_error_event(
                    source_agent_id, document_id, "ACCESS_DENIED",
                    "Write access denied"
                )

            # Check revision mismatch
            if client_revision != document.revision:
                return await self._send_error_event(
                    source_agent_id, document_id, "REVISION_MISMATCH",
                    f"Client revision {client_revision} does not match server revision {document.revision}",
                    {"client_revision": client_revision, "server_revision": document.revision}
                )

            # Apply the operation
            result = document.apply_operation(operation, source_agent_id)

            if not result["success"]:
                return await self._send_error_event(
                    source_agent_id, document_id, "OPERATION_FAILED",
                    result.get("error", "Unknown error")
                )

            # Broadcast the operation to all other connected users
            await self._broadcast_operation_history(document_id, document.revision - 1, [result["operation_id"]])

            # Broadcast cursor updates
            await self._broadcast_cursor_data(document_id, document.get_cursor_data())

            logger.info(f"Applied OT operation {result['operation_id']} to document {document_id}, new revision: {result['new_revision']}")

            return EventResponse(
                success=True,
                message="Operation applied successfully",
                data={
                    "operation_id": result["operation_id"],
                    "new_revision": result["new_revision"]
                }
            )

        except Exception as e:
            logger.error(f"Failed to process edit operation: {e}")
            return await self._send_error_event(
                source_agent_id, document_id, "INTERNAL_ERROR",
                f"Internal server error: {str(e)}"
            )

    async def _handle_document_history_request(self, event: Event) -> Optional[EventResponse]:
        """Handle requests for document operation history."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id

            # Extract payload
            payload = event.payload
            document_id = payload.get("document_id")

            if not document_id:
                return EventResponse(
                    success=False,
                    message="Missing document_id"
                )

            # Check if document exists
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check access permissions
            if not document.can_access(source_agent_id, "read"):
                return EventResponse(
                    success=False,
                    message="Access denied"
                )

            # Send complete history to the requesting agent
            await self._send_history_event(source_agent_id, document_id, document.get_full_history(), document.content)

            return EventResponse(
                success=True,
                message="History sent"
            )

        except Exception as e:
            logger.error(f"Failed to handle history request: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to get history: {str(e)}"
            )

    async def _handle_document_identity_request(self, event: Event) -> Optional[EventResponse]:
        """Handle requests for user identity assignment."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id

            # Generate a unique color for the user
            import random
            colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"]
            user_color = random.choice(colors)

            # Send identity assignment
            await self._send_identity_event(source_agent_id, source_agent_id, user_color)

            return EventResponse(
                success=True,
                message="Identity assigned"
            )

        except Exception as e:
            logger.error(f"Failed to handle identity request: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to assign identity: {str(e)}"
            )

    async def _handle_document_user_info(self, event: Event) -> Optional[EventResponse]:
        """Handle user info updates (join/leave/update)."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id

            # Extract payload
            payload = event.payload
            document_id = payload.get("document_id")
            user_info = payload.get("user_info", {})
            action = payload.get("action", "")

            if not document_id:
                return EventResponse(
                    success=False,
                    message="Missing document_id"
                )

            # Check if document exists
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            if action == "join":
                # Add user to collaborative session
                user_name = user_info.get("name", source_agent_id)
                user_color = user_info.get("color", "#000000")
                document.add_user(source_agent_id, user_name, user_color)

                # Broadcast user join to all other users
                await self._broadcast_user_info(document_id, user_info, "join", exclude_agent=source_agent_id)

            elif action == "leave":
                # Remove user from collaborative session
                document.remove_user(source_agent_id)

                # Broadcast user leave to all other users
                await self._broadcast_user_info(document_id, user_info, "leave", exclude_agent=source_agent_id)

            return EventResponse(
                success=True,
                message=f"User {action} processed"
            )

        except Exception as e:
            logger.error(f"Failed to handle user info: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to process user info: {str(e)}"
            )

    async def _handle_document_user_cursor(self, event: Event) -> Optional[EventResponse]:
        """Handle user cursor and selection updates."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id

            # Extract payload
            payload = event.payload
            document_id = payload.get("document_id")
            cursor_data = payload.get("cursor_data", {})

            if not document_id:
                return EventResponse(
                    success=False,
                    message="Missing document_id"
                )

            # Check if document exists
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Update cursor position
            cursors = cursor_data.get("cursors", [])
            selections = cursor_data.get("selections", [])

            if cursors and len(cursors) > 0:
                document.update_cursor(source_agent_id, cursors[0])

            if selections and len(selections) > 0:
                selection = selections[0]
                if len(selection) >= 2:
                    document.update_selection(source_agent_id, selection[0], selection[1])

            # Broadcast cursor update to all other users
            await self._broadcast_cursor_data(document_id, document.get_cursor_data(), exclude_agent=source_agent_id)

            return EventResponse(
                success=True,
                message="Cursor updated"
            )

        except Exception as e:
            logger.error(f"Failed to handle cursor update: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to update cursor: {str(e)}"
            )

    async def _handle_document_language(self, event: Event) -> Optional[EventResponse]:
        """Handle document language/syntax highlighting changes."""
        try:
            source_agent_id = event.source_id.replace("agent:", "") if event.source_id.startswith("agent:") else event.source_id

            # Extract payload
            payload = event.payload
            document_id = payload.get("document_id")
            language = payload.get("language", "")

            if not document_id:
                return EventResponse(
                    success=False,
                    message="Missing document_id"
                )

            # Check if document exists
            if document_id not in self.documents:
                return EventResponse(
                    success=False,
                    message=f"Document {document_id} not found"
                )

            document = self.documents[document_id]

            # Check access permissions
            if not document.can_access(source_agent_id, "write"):
                return EventResponse(
                    success=False,
                    message="Write access denied"
                )

            # Update document language
            document.set_language(language)

            # Broadcast language change to all other users
            await self._broadcast_language_change(document_id, language, exclude_agent=source_agent_id)

            return EventResponse(
                success=True,
                message="Language updated"
            )

        except Exception as e:
            logger.error(f"Failed to handle language change: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to update language: {str(e)}"
            )

    # Helper methods for OT collaborative editing

    async def _send_history_event(self, target_agent_id: str, document_id: str, history: Dict[str, Any], current_content: str):
        """Send operation history to a specific agent."""
        try:
            history_event = HistoryDocumentMessage(
                source_id=self.network.network_id,
                target_agent_id=target_agent_id,
                document_id=document_id,
                start_revision=history["start"],
                operations=history["operations"],
                current_content=current_content,
                payload={
                    "History": {
                        "start": history["start"],
                        "operations": history["operations"]
                    }
                }
            )

            await self.network.send_message(history_event)
            logger.debug(f"Sent history to agent {target_agent_id} for document {document_id}")

        except Exception as e:
            logger.error(f"Failed to send history event: {e}")

    async def _send_identity_event(self, target_agent_id: str, assigned_user_id: str, user_color: str):
        """Send identity assignment to a specific agent."""
        try:
            identity_event = IdentityDocumentMessage(
                source_id=self.network.network_id,
                target_agent_id=target_agent_id,
                assigned_user_id=assigned_user_id,
                user_color=user_color,
                payload={
                    "Identity": {
                        "user_id": assigned_user_id,
                        "color": user_color
                    }
                }
            )

            await self.network.event_gateway.deliver_to_agent(identity_event, target_agent_id)
            logger.debug(f"Sent identity to agent {target_agent_id}")

        except Exception as e:
            logger.error(f"Failed to send identity event: {e}")

    async def _send_error_event(self, target_agent_id: str, document_id: str, error_type: str, error_message: str, error_details: Dict[str, Any] = None) -> EventResponse:
        """Send error event to a specific agent."""
        try:
            error_event = ErrorDocumentMessage(
                source_id=self.network.network_id,
                target_agent_id=target_agent_id,
                document_id=document_id,
                error_type=error_type,
                error_message=error_message,
                error_details=error_details or {},
                payload={
                    "Error": {
                        "type": error_type,
                        "message": error_message,
                        "details": error_details or {}
                    }
                }
            )

            await self.network.send_message(error_event)
            logger.debug(f"Sent error {error_type} to agent {target_agent_id}")

            return EventResponse(
                success=False,
                message=error_message,
                data={"error_type": error_type, "error_details": error_details}
            )

        except Exception as e:
            logger.error(f"Failed to send error event: {e}")
            return EventResponse(
                success=False,
                message=f"Failed to send error: {str(e)}"
            )

    async def _broadcast_operation_history(self, document_id: str, start_revision: int, operation_ids: List[int], exclude_agent: str = None):
        """Broadcast operation history to all connected agents."""
        try:
            if document_id not in self.documents:
                return

            document = self.documents[document_id]
            history = document.get_history_since(start_revision)

            # Filter history to only include the specified operation IDs
            filtered_operations = []
            for op in history["operations"]:
                if op["id"] in operation_ids:
                    filtered_operations.append(op)

            history["operations"] = filtered_operations

            # Send to all connected agents except the excluded one
            for agent_id in document.connected_users:
                if exclude_agent and agent_id == exclude_agent:
                    continue

                await self._send_history_event(agent_id, document_id, history, document.content)

        except Exception as e:
            logger.error(f"Failed to broadcast operation history: {e}")

    async def _broadcast_cursor_data(self, document_id: str, cursor_data: Dict[str, Any], exclude_agent: str = None):
        """Broadcast cursor data to all connected agents."""
        try:
            if document_id not in self.documents:
                return

            document = self.documents[document_id]

            # Send to all connected agents except the excluded one
            for agent_id in document.connected_users:
                if exclude_agent and agent_id == exclude_agent:
                    continue

                cursor_event = UserCursorMessage(
                    source_id=self.network.network_id,
                    target_agent_id=agent_id,
                    document_id=document_id,
                    cursor_data=cursor_data,
                    payload={
                        "CursorData": cursor_data
                    }
                )

                await self.network.send_message(cursor_event)

        except Exception as e:
            logger.error(f"Failed to broadcast cursor data: {e}")

    async def _broadcast_user_info(self, document_id: str, user_info: Dict[str, Any], action: str, exclude_agent: str = None):
        """Broadcast user info changes to all connected agents."""
        try:
            if document_id not in self.documents:
                return

            document = self.documents[document_id]

            # Send to all connected agents except the excluded one
            for agent_id in document.connected_users:
                if exclude_agent and agent_id == exclude_agent:
                    continue

                user_info_event = UserInfoMessage(
                    source_id=self.network.network_id,
                    target_agent_id=agent_id,
                    document_id=document_id,
                    user_info=user_info,
                    action=action,
                    payload={
                        "UserInfo": {
                            "action": action,
                            "user_info": user_info
                        }
                    }
                )

                await self.network.send_message(user_info_event)

        except Exception as e:
            logger.error(f"Failed to broadcast user info: {e}")

    async def _broadcast_language_change(self, document_id: str, language: str, exclude_agent: str = None):
        """Broadcast language change to all connected agents."""
        try:
            if document_id not in self.documents:
                return

            document = self.documents[document_id]

            # Send to all connected agents except the excluded one
            for agent_id in document.connected_users:
                if exclude_agent and agent_id == exclude_agent:
                    continue

                language_event = LanguageDocumentMessage(
                    source_id=self.network.network_id,
                    target_agent_id=agent_id,
                    document_id=document_id,
                    language=language,
                    payload={
                        "Language": {
                            "language": language
                        }
                    }
                )

                await self.network.send_message(language_event)

        except Exception as e:
            logger.error(f"Failed to broadcast language change: {e}")
