import React, { useState, useEffect, useCallback } from "react";
import { DocumentsViewProps, DocumentInfo } from "../../types";
import { useThemeStore } from "@/stores/themeStore";
// TODO: Implement documents with new HTTP event system
import DocumentList from "./DocumentList";
import DocumentViewer from "./DocumentViewer";
import CreateDocumentModal from "./CreateDocumentModal";

const DocumentsView: React.FC<DocumentsViewProps> = ({
  onBackClick,
  // Shared state props (optional)
  documents: sharedDocuments,
  selectedDocumentId: sharedSelectedDocumentId,
  onDocumentSelect: sharedOnDocumentSelect,
  onDocumentsChange: sharedOnDocumentsChange,
}) => {
  // Use theme from store
  const { theme: currentTheme } = useThemeStore();
  // TODO: Connect to HTTP event system for documents
  const currentNetwork = null;
  const [connection, setConnection] = useState<any | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Use shared state if available, otherwise use local state
  const effectiveDocuments = sharedDocuments || documents;
  const effectiveSelectedDocument =
    sharedSelectedDocumentId || selectedDocument;
  const effectiveConnection = connection;

  // Initialize connection
  useEffect(() => {
    let isMounted = true;
    let currentConnection: any = null;

    const initConnection = async () => {
      if (!currentNetwork || !isMounted) return;

      try {
        // TODO: Initialize HTTP event connector for documents
        const conn = null;
        currentConnection = conn;
        const connected = false;
        if (connected && isMounted) {
          setConnection(conn);
          setError(null);
          console.log("📄 Connected for documents management");
        } else if (isMounted) {
          setError("Failed to connect to the network");
        }
      } catch (err) {
        console.error("Failed to initialize documents connection:", err);
        if (isMounted) {
          setError("Failed to initialize documents connection");
        }
      }
    };

    initConnection();

    return () => {
      isMounted = false;
      if (currentConnection) {
        try {
          currentConnection.disconnect();
          console.log("📄 Documents connection cleaned up");
        } catch (e) {
          console.warn("⚠️ Error cleaning up documents connection:", e);
        }
      }
    };
  }, [currentNetwork]);

  // Handle documents received from HTTP event service
  const handleDocumentsReceived = useCallback(
    (docs: DocumentInfo[]) => {
      console.log("📋 Documents received via event:", docs);

      // Update shared state if available, otherwise local state
      if (sharedOnDocumentsChange) {
        sharedOnDocumentsChange(docs || []);
      } else {
        setDocuments(docs || []);
      }

      setIsLoading(false);
      setError(null);
    },
    [sharedOnDocumentsChange]
  );

  // Load documents by requesting them (triggers events)
  const loadDocuments = useCallback(async () => {
    if (!effectiveConnection) return;

    try {
      setIsLoading(true);
      setError(null);

      // Request documents list using the public API
      const docs = await effectiveConnection.listDocuments(false);
      console.log("📤 Received documents list:", docs);
      handleDocumentsReceived(docs || []);
      setIsLoading(false);
    } catch (err) {
      console.error("Failed to request documents:", err);
      setError("Failed to load documents");
      setIsLoading(false);
    }
  }, [effectiveConnection]);

  // Handle document creation events
  const handleDocumentCreated = useCallback(
    (data: any) => {
      console.log("📄 Document created event received:", data);
      // Refresh the document list
      loadDocuments();
    },
    [loadDocuments]
  );

  // Set up event listeners
  useEffect(() => {
    if (effectiveConnection) {
      // Listen for documents events
      effectiveConnection.on("documents", handleDocumentsReceived);
      effectiveConnection.on("document_created", handleDocumentCreated);

      // Load initial documents
      loadDocuments();

      // Cleanup event listeners
      return () => {
        effectiveConnection.off("documents", handleDocumentsReceived);
        effectiveConnection.off("document_created", handleDocumentCreated);
      };
    }
  }, [
    effectiveConnection,
    loadDocuments,
    handleDocumentsReceived,
    handleDocumentCreated,
  ]);

  const handleCreateDocument = async (
    name: string,
    content: string,
    permissions: Record<string, string>
  ) => {
    if (!effectiveConnection) return;

    try {
      const documentId = await effectiveConnection.createDocument(
        name,
        content,
        permissions
      );
      console.log("📄 Document creation initiated:", documentId);

      // Request updated document list (will trigger 'documents' event)
      await loadDocuments();
      setShowCreateModal(false);
    } catch (err) {
      console.error("Failed to create document:", err);
      // Handle error in modal
    }
  };

  const handleDocumentSelect = (documentId: string) => {
    // Use shared handler if available, otherwise local state
    if (sharedOnDocumentSelect) {
      sharedOnDocumentSelect(documentId);
    } else {
      setSelectedDocument(documentId);
    }
  };

  const handleBackToList = () => {
    // Use shared handler if available, otherwise local state
    if (sharedOnDocumentSelect) {
      sharedOnDocumentSelect(null);
    } else {
      setSelectedDocument(null);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p
            className={`${
              currentTheme === "dark" ? "text-gray-400" : "text-gray-600"
            }`}
          >
            Loading documents...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.864-.833-2.634 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h3
            className={`text-lg font-medium mb-2 ${
              currentTheme === "dark" ? "text-gray-200" : "text-gray-800"
            }`}
          >
            Connection Error
          </h3>
          <p
            className={`${
              currentTheme === "dark" ? "text-gray-400" : "text-gray-600"
            } mb-4`}
          >
            {error}
          </p>
          <button
            onClick={onBackClick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  if (effectiveSelectedDocument) {
    return (
      <DocumentViewer
        documentId={effectiveSelectedDocument}
        connection={effectiveConnection!}
        currentTheme={currentTheme}
        onBack={handleBackToList}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className={`border-b ${
          currentTheme === "dark" ? "border-gray-700" : "border-gray-200"
        } p-6`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackClick}
              className={`p-2 rounded-lg transition-colors ${
                currentTheme === "dark"
                  ? "hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                  : "hover:bg-gray-100 text-gray-600 hover:text-gray-800"
              }`}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div>
              <h1
                className={`text-2xl font-bold ${
                  currentTheme === "dark" ? "text-gray-200" : "text-gray-800"
                }`}
              >
                Shared Documents
              </h1>
              <p
                className={`text-sm ${
                  currentTheme === "dark" ? "text-gray-400" : "text-gray-600"
                }`}
              >
                Collaborate on documents with other agents in real-time
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>New Document</span>
          </button>
        </div>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-hidden">
        <DocumentList
          documents={effectiveDocuments}
          currentTheme={currentTheme}
          onDocumentSelect={handleDocumentSelect}
          onRefresh={loadDocuments}
        />
      </div>

      {/* Create Document Modal */}
      {showCreateModal && (
        <CreateDocumentModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreateDocument={handleCreateDocument}
          currentTheme={currentTheme}
        />
      )}
    </div>
  );
};

export default DocumentsView;
