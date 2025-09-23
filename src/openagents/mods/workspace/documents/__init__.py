"""Shared document mod for collaborative editing."""

from .adapter import SharedDocumentAgentAdapter
from .mod import SharedDocumentNetworkMod, SharedDocument
from .document_messages import *

__all__ = [
    "SharedDocumentAgentAdapter",
    "SharedDocumentNetworkMod", 
    "SharedDocument",
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
