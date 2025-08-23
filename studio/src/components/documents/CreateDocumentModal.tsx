import React, { useState } from 'react';

interface CreateDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateDocument: (name: string, content: string, permissions: Record<string, string>) => Promise<void>;
  currentTheme: 'light' | 'dark';
}

const CreateDocumentModal: React.FC<CreateDocumentModalProps> = ({
  isOpen,
  onClose,
  onCreateDocument,
  currentTheme
}) => {
  const [documentName, setDocumentName] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [newAgentId, setNewAgentId] = useState('');
  const [newPermission, setNewPermission] = useState<'read_only' | 'read_write' | 'admin'>('read_write');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddPermission = () => {
    if (newAgentId.trim() && !permissions[newAgentId]) {
      setPermissions(prev => ({
        ...prev,
        [newAgentId.trim()]: newPermission
      }));
      setNewAgentId('');
    }
  };

  const handleRemovePermission = (agentId: string) => {
    setPermissions(prev => {
      const updated = { ...prev };
      delete updated[agentId];
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!documentName.trim()) {
      setError('Document name is required');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      await onCreateDocument(documentName.trim(), initialContent, permissions);
      // Reset form
      setDocumentName('');
      setInitialContent('');
      setPermissions({});
      setNewAgentId('');
      onClose();
    } catch (err) {
      setError('Failed to create document. Please try again.');
      console.error('Failed to create document:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setDocumentName('');
      setInitialContent('');
      setPermissions({});
      setNewAgentId('');
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`
        w-full max-w-2xl rounded-lg shadow-xl
        ${currentTheme === 'dark' ? 'bg-gray-800' : 'bg-white'}
      `}>
        {/* Header */}
        <div className={`border-b p-6 ${currentTheme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-xl font-bold ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
              Create New Document
            </h2>
            <button
              onClick={handleClose}
              disabled={isCreating}
              className={`p-2 rounded-lg transition-colors ${
                currentTheme === 'dark'
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200'
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-800'
              } disabled:opacity-50`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-100 border border-red-300 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Document Name */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-700'
            }`}>
              Document Name *
            </label>
            <input
              type="text"
              value={documentName}
              onChange={(e) => setDocumentName(e.target.value)}
              placeholder="Enter document name..."
              disabled={isCreating}
              className={`
                w-full p-3 border rounded-lg transition-colors
                ${currentTheme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400 focus:border-blue-500'
                  : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500 focus:border-blue-500'
                }
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50
                disabled:opacity-50
              `}
              required
            />
          </div>

          {/* Initial Content */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-700'
            }`}>
              Initial Content
            </label>
            <textarea
              value={initialContent}
              onChange={(e) => setInitialContent(e.target.value)}
              placeholder="Enter initial document content... (optional)"
              disabled={isCreating}
              rows={8}
              className={`
                w-full p-3 border rounded-lg transition-colors font-mono text-sm resize-none
                ${currentTheme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400 focus:border-blue-500'
                  : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500 focus:border-blue-500'
                }
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50
                disabled:opacity-50
              `}
            />
          </div>

          {/* Access Permissions */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-700'
            }`}>
              Access Permissions
            </label>
            
            {/* Add Permission */}
            <div className="flex space-x-2 mb-3">
              <input
                type="text"
                value={newAgentId}
                onChange={(e) => setNewAgentId(e.target.value)}
                placeholder="Agent ID"
                disabled={isCreating}
                className={`
                  flex-1 p-2 border rounded transition-colors
                  ${currentTheme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'
                  }
                  focus:outline-none focus:border-blue-500
                  disabled:opacity-50
                `}
              />
              <select
                value={newPermission}
                onChange={(e) => setNewPermission(e.target.value as 'read_only' | 'read_write' | 'admin')}
                disabled={isCreating}
                className={`
                  p-2 border rounded transition-colors
                  ${currentTheme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-gray-200'
                    : 'bg-white border-gray-300 text-gray-800'
                  }
                  focus:outline-none focus:border-blue-500
                  disabled:opacity-50
                `}
              >
                <option value="read_only">Read Only</option>
                <option value="read_write">Read Write</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="button"
                onClick={handleAddPermission}
                disabled={!newAgentId.trim() || isCreating}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>

            {/* Permission List */}
            {Object.keys(permissions).length > 0 && (
              <div className={`border rounded-lg p-3 ${currentTheme === 'dark' ? 'border-gray-600' : 'border-gray-300'}`}>
                <div className="space-y-2">
                  {Object.entries(permissions).map(([agentId, permission]) => (
                    <div key={agentId} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className={`font-medium ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                          {agentId}
                        </span>
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          permission === 'admin' 
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                            : permission === 'read_write'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
                        }`}>
                          {permission.replace('_', ' ')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePermission(agentId)}
                        disabled={isCreating}
                        className={`p-1 rounded transition-colors ${
                          currentTheme === 'dark'
                            ? 'hover:bg-gray-600 text-gray-400 hover:text-gray-200'
                            : 'hover:bg-gray-200 text-gray-600 hover:text-gray-800'
                        } disabled:opacity-50`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isCreating}
              className={`
                px-4 py-2 rounded-lg transition-colors
                ${currentTheme === 'dark'
                  ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!documentName.trim() || isCreating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              {isCreating && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              )}
              <span>{isCreating ? 'Creating...' : 'Create Document'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateDocumentModal;
