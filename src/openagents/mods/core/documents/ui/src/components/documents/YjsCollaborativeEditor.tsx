import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useOpenAgents } from '../../context/OpenAgentsProvider';

interface YjsCollaborativeEditorProps {
  documentId: string;
  initialContent: string;
  onSave?: (content: string) => void;
  readOnly?: boolean;
  language?: string;
}

/**
 * YjsCollaborativeEditor - Simplified version for documents module
 * 
 * Note: Full Yjs integration requires OpenAgentsYjsProvider and additional dependencies.
 * This is a simplified version that uses basic text editing.
 */
const YjsCollaborativeEditor: React.FC<YjsCollaborativeEditorProps> = ({
  documentId,
  initialContent,
  onSave,
  readOnly = false,
  language = 'markdown',
}) => {
  const { connector: connection } = useOpenAgents();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');

  // Update content when initialContent changes
  useEffect(() => {
    if (initialContent !== content) {
      setContent(initialContent);
    }
  }, [initialContent]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  const handleSave = useCallback(async () => {
    if (!connection || !onSave) return;

    setIsSaving(true);
    setSyncStatus('syncing');

    try {
      await onSave(content);
      setSyncStatus('synced');
    } catch (error) {
      console.error('Failed to save document:', error);
      setSyncStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [connection, content, onSave]);

  // Keyboard shortcut for save (Cmd/Ctrl + S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  return (
    <div className="yjs-collaborative-editor relative h-full w-full flex flex-col">
      {/* Status bar */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-1 rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              syncStatus === 'synced'
                ? 'bg-green-500'
                : syncStatus === 'syncing'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {syncStatus === 'synced' ? 'Synced' : syncStatus === 'syncing' ? 'Syncing...' : 'Error'}
          </span>
        </div>

        <button
          onClick={handleSave}
          disabled={readOnly || isSaving}
          className="ml-2 px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Text Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleContentChange}
        disabled={readOnly}
        className="w-full h-full p-4 font-mono text-sm resize-none border-none outline-none bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        placeholder={readOnly ? 'This document is read-only' : 'Start typing...'}
        style={{
          lineHeight: '1.6',
          tabSize: 2,
        }}
      />
    </div>
  );
};

export default YjsCollaborativeEditor;

