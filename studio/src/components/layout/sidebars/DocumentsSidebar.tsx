import React from "react";
import { DocumentInfo } from "@/types";
import { formatRelativeDate } from "@/utils/utils";
import { useThreadStore } from "@/stores/threadStore";

// Section Header Component
const SectionHeader: React.FC<{ title: string }> = React.memo(({ title }) => (
  <div className="px-5">
    <div className="flex items-center my-3">
      <div className="text-xs font-bold text-gray-400 tracking-wide select-none">
        {title}
      </div>
      <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
    </div>
  </div>
));
SectionHeader.displayName = "SectionHeader";

// Document List Item Component
const DocumentItem: React.FC<{
  document: DocumentInfo;
  isSelected: boolean;
  onClick: () => void;
}> = React.memo(({ document, isSelected, onClick }) => (
  <li>
    <button
      onClick={onClick}
      className={`w-full text-left text-sm px-2 py-3 font-medium rounded transition-colors
        ${
          isSelected
            ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
            : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
        }
      `}
      title={document.name}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center mb-1">
            <svg
              className="w-4 h-4 mr-2 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="truncate font-medium">{document.name}</span>
          </div>
          <div className="text-xs opacity-75 ml-6">
            <div className="truncate">
              v{document.version} • {document.creator}
            </div>
            <div className="mt-0.5">
              {formatRelativeDate(document.last_modified)}
            </div>
          </div>
        </div>
        {document.active_agents.length > 0 && (
          <div className="ml-2 flex items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="ml-1 text-xs opacity-75">
              {document.active_agents.length}
            </span>
          </div>
        )}
      </div>
    </button>
  </li>
));
DocumentItem.displayName = "DocumentItem";

// Documents Sidebar Props - 现在不需要外部传递数据
export interface DocumentsSidebarProps {}

// Documents Sidebar Content Component - 自己管理数据
const DocumentsSidebar: React.FC<DocumentsSidebarProps> = () => {
  // 使用 threadStore 获取实际数据
  const { documents, selectedDocumentId, setSelectedDocument } =
    useThreadStore();

  // 文档选择处理
  const onDocumentSelect = (documentId: string | null) => {
    setSelectedDocument(documentId);
  };

  // Sort documents by last modified date (most recent first)
  const sortedDocuments = [...documents].sort((a, b) => {
    return (
      new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime()
    );
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Documents Section */}
      <SectionHeader title="DOCUMENTS" />
      <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
        {sortedDocuments.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-400 dark:text-gray-500 text-sm">
              <svg
                className="w-12 h-12 mx-auto mb-3 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              No documents yet
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sortedDocuments.map((doc) => (
              <DocumentItem
                key={doc.document_id}
                document={doc}
                isSelected={selectedDocumentId === doc.document_id}
                onClick={() => onDocumentSelect?.(doc.document_id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default React.memo(DocumentsSidebar);
