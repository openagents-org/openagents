import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { DocumentInfo } from "../../types";
import { EmptyState } from "@/components/layout/ui/empty-state";
import { FileText } from "lucide-react";

interface DocumentListProps {
  documents: DocumentInfo[];
  currentTheme: "light" | "dark";
  onDocumentSelect: (documentId: string) => void;
}

const DocumentList: React.FC<DocumentListProps> = ({
  documents,
  currentTheme,
  onDocumentSelect,
}) => {
  const { t } = useTranslation('documents');
  const navigate = useNavigate();
  // Sort documents by last modified date (most recent first)
  const sortedDocuments = useMemo(() => {
    return [...documents].sort((a, b) => {
      return (
        new Date(b.last_modified).getTime() -
        new Date(a.last_modified).getTime()
      );
    });
  }, [documents]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return t('list.justNow');
    if (diffMins < 60) return t('list.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('list.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('list.daysAgo', { count: diffDays });

    return date.toLocaleDateString();
  };

  const getActiveAgentsList = (activeAgents: string[]) => {
    if (activeAgents.length === 0) return t('list.noActiveEditors');
    if (activeAgents.length === 1) return t('list.isEditing', { user: activeAgents[0] });
    if (activeAgents.length <= 3)
      return t('list.areEditing', { users: activeAgents.join(", ") });
    return t('list.othersEditing', { 
      users: activeAgents.slice(0, 2).join(", "),
      count: activeAgents.length - 2
    });
  };

  if (documents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <EmptyState
          variant="minimal"
          icon={<FileText className="w-12 h-12" />}
          title={t('list.noDocuments')}
          description={t('list.createFirst')}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {sortedDocuments.map((document) => (
          <div
            key={document.document_id}
            onClick={() => navigate(`/documents/${document.document_id}`)}
            className={`
              p-6 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md
              ${currentTheme === "dark"
                ? "bg-zinc-950 border-gray-700 hover:bg-zinc-900 hover:border-gray-600"
                : "bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300"
              }
            `}
          >
            {/* Document Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <h3
                  className={`font-semibold text-lg truncate ${currentTheme === "dark" ? "text-gray-200" : "text-gray-800"
                    }`}
                >
                  {document.name}
                </h3>
                <p
                  className={`text-sm ${currentTheme === "dark" ? "text-gray-400" : "text-gray-600"
                    }`}
                >
                  {t('list.createdBy', { user: document.creator })}
                </p>
              </div>
            </div>

            {/* Last Modified */}
            <div
              className={`text-sm mb-3 ${currentTheme === "dark" ? "text-gray-400" : "text-gray-600"
                }`}
            >
              <span className="flex items-center">
                <svg
                  className="w-4 h-4 mr-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {t('list.lastModified', { time: formatDate(document.last_modified) })}
              </span>
            </div>

            {/* Active Agents */}
            <div className="flex items-center justify-between">
              <div
                className={`text-sm ${currentTheme === "dark" ? "text-gray-400" : "text-gray-600"
                  }`}
              >
                <span className="flex items-center">
                  <svg
                    className="w-4 h-4 mr-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  {getActiveAgentsList(document.active_agents)}
                </span>
              </div>

              {/* Active indicator */}
              {document.active_agents.length > 0 && (
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span
                    className={`ml-1 text-xs ${currentTheme === "dark"
                        ? "text-green-400"
                        : "text-green-600"
                      }`}
                  >
                    {t('list.active')}
                  </span>
                </div>
              )}
            </div>

            {/* Document actions hint */}
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div
                className={`text-xs ${currentTheme === "dark" ? "text-gray-500" : "text-gray-400"
                  } flex items-center justify-between`}
              >
                <span>{t('list.clickToOpen')}</span>
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
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DocumentList;
