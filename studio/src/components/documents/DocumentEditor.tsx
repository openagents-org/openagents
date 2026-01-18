import React, { useEffect, useState, useCallback, Suspense, lazy } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDocumentStore } from "@/stores/documentStore";
import { useThemeStore } from "@/stores/themeStore";

// Lazy load the collaborative editor (includes Monaco)
const YjsCollaborativeEditor = lazy(() => import("./YjsCollaborativeEditor"));

const DocumentEditor: React.FC = () => {
  const { t } = useTranslation('documents');
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const { theme } = useThemeStore();

  const { documents, getDocument, leaveDocument, saveDocumentContent } =
    useDocumentStore();

  const [document, setDocument] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load document from backend
  useEffect(() => {
    if (!documentId) {
      setError("Document ID does not exist");
      setIsLoading(false);
      return;
    }

    const loadDocument = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const documentData = await getDocument(documentId);
        if (documentData) {
          setDocument(documentData);
          setIsLoading(false);
        } else {
          setError("Failed to load document");
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Error loading document:", err);
        setError("Failed to load document");
        setIsLoading(false);
      }
    };

    loadDocument();
  }, [documentId, getDocument]);

  // Sync local document state with store (for active_agents updates)
  useEffect(() => {
    if (!documentId) return;

    const storeDocument = documents.find(
      (doc) => doc.document_id === documentId
    );
    // Only sync if active_agents has values, to avoid overwriting with empty array
    if (
      storeDocument &&
      storeDocument.active_agents &&
      storeDocument.active_agents.length > 0
    ) {
      setDocument((prev: any) => ({
        ...prev,
        active_users: storeDocument.active_agents,
      }));
    }
  }, [documentId, documents]);

  // Handle save from Monaco editor
  const handleSave = useCallback(
    async (content: string) => {
      if (!documentId) return;

      try {
        const success = await saveDocumentContent(documentId, content);
        if (success) {
          console.log("✅ Document saved successfully");
        } else {
          console.error("❌ Failed to save document");
        }
      } catch (error) {
        console.error("❌ Save error:", error);
      }
    },
    [documentId, saveDocumentContent]
  );

  // Return to document list and leave document
  const handleBack = useCallback(async () => {
    if (documentId) {
      await leaveDocument(documentId);
    }
    navigate("/documents");
  }, [documentId, leaveDocument, navigate]);

  // Leave document on unmount
  useEffect(() => {
    return () => {
      if (documentId) {
        leaveDocument(documentId);
      }
    };
  }, [documentId, leaveDocument]);


  if (isLoading) {
    return (
      <div
        className={`h-screen flex items-center justify-center ${
          theme === "dark" ? "bg-gray-900" : "bg-white"
        }`}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className={theme === "dark" ? "text-gray-400" : "text-gray-600"}>
            {t('view.loadingDocuments')}
          </p>
        </div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div
        className={`h-screen flex items-center justify-center ${
          theme === "dark" ? "bg-gray-900" : "bg-white"
        }`}
      >
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
              theme === "dark" ? "text-gray-200" : "text-gray-800"
            }`}
          >
            {t('view.connectionError')}
          </h3>
          <p
            className={`${
              theme === "dark" ? "text-gray-400" : "text-gray-600"
            } mb-4`}
          >
            {error}
          </p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('view.backToList')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-screen flex flex-col ${
        theme === "dark" ? "bg-gray-900" : "bg-white"
      }`}
    >
      {/* Top title bar */}
      <div
        className={`flex items-center justify-between p-4 border-b ${
          theme === "dark"
            ? "border-gray-700 bg-gray-800"
            : "border-gray-200 bg-white"
        }`}
      >
        <div className="flex items-center space-x-4">
          <button
            onClick={handleBack}
            className={`p-2 rounded-lg transition-colors ${
              theme === "dark"
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
              className={`text-xl font-bold ${
                theme === "dark" ? "text-gray-200" : "text-gray-800"
              }`}
            >
              {document.document_name || document.name}
            </h1>
            <div
              className={`text-sm ${
                theme === "dark" ? "text-gray-400" : "text-gray-600"
              }`}
            >
              {t('list.createdBy', { user: document.creator_agent_id || document.creator })}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Online users */}
          {document?.active_users && document.active_users.length > 0 && (
            <div className="flex items-center space-x-2">
              <div
                className={`text-sm ${
                  theme === "dark" ? "text-gray-400" : "text-gray-600"
                }`}
              >
                {t('status.online')}:
              </div>
              <div className="flex -space-x-2">
                {document.active_users.slice(0, 5).map((userId: string) => (
                  <div
                    key={userId}
                    className={`w-8 h-8 rounded-full border-2 ${
                      theme === "dark"
                        ? "border-gray-700 bg-blue-600"
                        : "border-white bg-blue-500"
                    } flex items-center justify-center text-xs font-medium text-white`}
                    title={userId}
                  >
                    {userId.substring(0, 2).toUpperCase()}
                  </div>
                ))}
                {document.active_users.length > 5 && (
                  <div
                    className={`w-8 h-8 rounded-full border-2 ${
                      theme === "dark"
                        ? "border-gray-700 bg-gray-600"
                        : "border-white bg-gray-400"
                    } flex items-center justify-center text-xs font-medium text-white`}
                  >
                    +{document.active_users.length - 5}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Yjs Collaborative Editor */}
      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">
                  Loading editor...
                </p>
              </div>
            </div>
          }
        >
          <YjsCollaborativeEditor
            documentId={documentId!}
            initialContent={document?.content || ""}
            language="typescript"
            onSave={handleSave}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default DocumentEditor;
