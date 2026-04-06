"""Documents mod for document management."""

from .adapter import DocumentsAgentAdapter
from .mod import DocumentsNetworkMod, Document
from .document_messages import *

# Backward compatibility aliases
SharedDocumentAgentAdapter = DocumentsAgentAdapter
SharedDocumentNetworkMod = DocumentsNetworkMod
SharedDocument = Document

__all__ = [
    "DocumentsAgentAdapter",
    "DocumentsNetworkMod",
    "Document",
    "SharedDocumentAgentAdapter",  # Backward compatibility
    "SharedDocumentNetworkMod",  # Backward compatibility
    "SharedDocument",  # Backward compatibility
    # Document messages
    "CreateDocumentMessage",
    "SaveDocumentMessage",
    "RenameDocumentMessage",
    "GetDocumentMessage",
    "GetDocumentHistoryMessage",
    "ListDocumentsMessage",
    "DocumentOperationResponse",
    "DocumentGetResponse",
    "DocumentListResponse",
    "DocumentHistoryResponse",
    "DocumentOperation",
]
