import React, { useCallback } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { DocumentsView } from "@/components";
import { useThreadStore } from "@/stores/threadStore";

/**
 * 文档主页面 - 处理文档相关的所有功能
 */
const DocumentsMainPage: React.FC = () => {
  const navigate = useNavigate();

  const { documents, selectedDocumentId, setSelectedDocument, setDocuments } =
    useThreadStore();

  // 文档选择处理器
  const handleDocumentSelect = useCallback(
    (documentId: string | null) => {
      setSelectedDocument(documentId);
    },
    [setSelectedDocument]
  );

  return (
    <Routes>
      {/* 默认文档视图 */}
      <Route
        index
        element={
          <DocumentsView
            onBackClick={() => navigate("/chat")}
            documents={documents}
            selectedDocumentId={selectedDocumentId}
            onDocumentSelect={handleDocumentSelect}
            onDocumentsChange={setDocuments}
          />
        }
      />

      {/* 文档详情页面 */}
      <Route
        path=":documentId"
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Document Details
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Document detail view coming soon...
            </p>
          </div>
        }
      />
    </Routes>
  );
};

export default DocumentsMainPage;
