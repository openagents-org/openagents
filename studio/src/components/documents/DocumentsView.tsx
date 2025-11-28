import React, { useState } from "react";
import { DocumentsViewProps } from "../../types";
import { useThemeStore } from "@/stores/themeStore";
import { useDocumentStore } from "@/stores/documentStore";
import DocumentList from "./DocumentList";
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

  // Use document store
  const {
    documents: storeDocuments,
    createDocument,
  } = useDocumentStore();

  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Use shared state if available, otherwise use store state
  const effectiveDocuments = sharedDocuments || storeDocuments;
  const effectiveSelectedDocument =
    sharedSelectedDocumentId || selectedDocument;


  const handleCreateDocument = async (
    name: string,
    content: string
  ) => {
    try {
      const documentId = await createDocument(name, content);
      console.log("📄 Document created:", documentId);

      setShowCreateModal(false);
    } catch (err) {
      console.error("Failed to create document:", err);
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
      <div className="h-full flex items-center justify-center dark:bg-gray-900">
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
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
          Document Details
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Document ID: {effectiveSelectedDocument}
        </p>
        <button
          onClick={handleBackToList}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to List
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div
        className={`border-b ${
          currentTheme === "dark" ? "border-gray-700" : "border-gray-200"
        } p-6`}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              Shared Documents
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Open the same document in different browser windows to start
              real-time collaborative editing
            </p>
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
