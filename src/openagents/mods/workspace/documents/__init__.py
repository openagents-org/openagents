"""Shared document mod for collaborative editing."""

from .adapter import SharedDocumentAgentAdapter
from .mod import SharedDocumentNetworkMod, SharedDocument
from .document_messages import *

__all__ = [
    "SharedDocumentAgentAdapter",
    "SharedDocumentNetworkMod", 
    "SharedDocument",
    # OT Operation Types
    "OTOperation",
    "OTRetain",
    "OTInsert",
    "OTDelete",
    "OTCompositeOperation",
    "CursorInfo",
    "SelectionInfo",
    "UserInfo",
    # OT Collaborative Editing Messages
    "HistoryDocumentMessage",
    "IdentityDocumentMessage",
    "UserInfoMessage",
    "UserCursorMessage",
    "LanguageDocumentMessage",
    "ErrorDocumentMessage",
    "EditDocumentMessage",
    # Document messages
    "CreateDocumentMessage",
    "OpenDocumentMessage",
    "CloseDocumentMessage",
    "InsertLinesMessage",
    "RemoveLinesMessage",
    "ReplaceLinesMessage",
    "AddCommentMessage",
    "RemoveCommentMessage",
    "UpdateCursorPositionMessage",
    "GetDocumentContentMessage",
    "GetDocumentHistoryMessage",
    "ListDocumentsMessage",
    "GetAgentPresenceMessage",
    "DocumentOperationResponse",
    "DocumentContentResponse",
    "DocumentListResponse",
    "DocumentHistoryResponse",
    "AgentPresenceResponse",
    "CursorPosition",
    "DocumentComment",
    "AgentPresence"
]
