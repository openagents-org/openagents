import React, { useMemo } from 'react';
import { DocumentInfo } from '../../types';

interface DocumentListProps {
  documents: DocumentInfo[];
  currentTheme: 'light' | 'dark';
  onDocumentSelect: (documentId: string) => void;
  onRefresh: () => void;
}

const DocumentList: React.FC<DocumentListProps> = ({
  documents,
  currentTheme,
  onDocumentSelect,
  onRefresh
}) => {
  // Sort documents by last modified date (most recent first)
  const sortedDocuments = useMemo(() => {
    return [...documents].sort((a, b) => {
      return new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime();
    });
  }, [documents]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  const getPermissionBadge = (permission: string) => {
    const colors = {
      admin: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
      read_write: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400',
      read_only: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[permission as keyof typeof colors] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
        {permission.replace('_', ' ')}
      </span>
    );
  };

  const getActiveAgentsList = (activeAgents: string[]) => {
    if (activeAgents.length === 0) return 'No active editors';
    if (activeAgents.length === 1) return `${activeAgents[0]} is editing`;
    if (activeAgents.length <= 3) return `${activeAgents.join(', ')} are editing`;
    return `${activeAgents.slice(0, 2).join(', ')} and ${activeAgents.length - 2} others are editing`;
  };

  if (documents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className={`text-6xl mb-4 ${currentTheme === 'dark' ? 'text-gray-600' : 'text-gray-400'}`}>
            📄
          </div>
          <h3 className={`text-lg font-medium mb-2 ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
            No documents yet
          </h3>
          <p className={`${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'} mb-4`}>
            Create your first shared document to start collaborating
          </p>
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {sortedDocuments.map((document) => (
          <div
            key={document.document_id}
            onClick={() => onDocumentSelect(document.document_id)}
            className={`
              p-6 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md
              ${currentTheme === 'dark' 
                ? 'bg-gray-800 border-gray-700 hover:bg-gray-750 hover:border-gray-600' 
                : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
              }
            `}
          >
            {/* Document Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <h3 className={`font-semibold text-lg truncate ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                  {document.name}
                </h3>
                <p className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  v{document.version} • Created by {document.creator}
                </p>
              </div>
              {getPermissionBadge(document.permission)}
            </div>

            {/* Last Modified */}
            <div className={`text-sm mb-3 ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              <span className="flex items-center">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Last modified {formatDate(document.last_modified)}
              </span>
            </div>

            {/* Active Agents */}
            <div className="flex items-center justify-between">
              <div className={`text-sm ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                <span className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  {getActiveAgentsList(document.active_agents)}
                </span>
              </div>

              {/* Active indicator */}
              {document.active_agents.length > 0 && (
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className={`ml-1 text-xs ${currentTheme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                    Active
                  </span>
                </div>
              )}
            </div>

            {/* Document actions hint */}
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className={`text-xs ${currentTheme === 'dark' ? 'text-gray-500' : 'text-gray-400'} flex items-center justify-between`}>
                <span>Click to open</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Refresh button */}
      <div className="mt-8 text-center">
        <button
          onClick={onRefresh}
          className={`
            px-4 py-2 rounded-lg transition-colors
            ${currentTheme === 'dark' 
              ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }
          `}
        >
          <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>
    </div>
  );
};

export default DocumentList;
