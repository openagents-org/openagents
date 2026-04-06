/**
 * YjsCollaborativeEditor - Yjs-based collaborative document editor
 *
 * Uses Yjs CRDT for conflict-free collaborative editing without WebSocket.
 * Integrates with OpenAgents event system via OpenAgentsYjsProvider.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { editor } from 'monaco-editor';
import { toast } from 'sonner';
import { OpenAgentsYjsProvider } from '../../providers/OpenAgentsYjsProvider';
import { useOpenAgents } from '../../context/OpenAgentsProvider';

interface YjsCollaborativeEditorProps {
  documentId: string;
  initialContent: string;
  onSave?: (content: string) => void;
  readOnly?: boolean;
  language?: string;
}

interface UserCursor {
  agentId: string;
  position: {
    lineNumber: number;
    column: number;
  };
  color?: string;
}

export const YjsCollaborativeEditor: React.FC<YjsCollaborativeEditorProps> = ({
  documentId,
  initialContent,
  onSave,
  readOnly = false,
  language = 'markdown',
}) => {
  const { connector: connection } = useOpenAgents();

  // Editor refs
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);

  // Yjs refs
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<OpenAgentsYjsProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  // State
  const [userCursors, setUserCursors] = useState<UserCursor[]>([]);
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'synced' | 'error'>('syncing');

  // Initialization ref to ensure single initialization
  const hasInitialized = useRef(false);

  // Cursor decorations
  const decorationsRef = useRef<string[]>([]);

  /**
   * Initialize Yjs document and provider (ONCE)
   */
  useEffect(() => {
    if (!connection || !documentId || hasInitialized.current) return;

    console.log('🚀 [Yjs Init] Initializing YjsCollaborativeEditor for document:', documentId);
    hasInitialized.current = true;

    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Create custom provider
    const provider = new OpenAgentsYjsProvider(ydoc, connection, documentId);
    providerRef.current = provider;

    // Initialize with initial content
    provider.initialize(initialContent).then(() => {
      console.log('✅ [Yjs Init] Provider initialized successfully');
      setSyncStatus('synced');
    }).catch((error) => {
      console.error('❌ [Yjs Init] Provider initialization failed:', error);
      setSyncStatus('error');
    });

    return () => {
      console.log('🛑 [Yjs Cleanup] Cleaning up YjsCollaborativeEditor');

      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }

      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }

      if (ydocRef.current) {
        ydocRef.current.destroy();
        ydocRef.current = null;
      }

      hasInitialized.current = false;
    };
  }, [connection, documentId, initialContent]);

  /**
   * Handle Monaco editor mount
   */
  const handleEditorDidMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: any) => {
      console.log('📝 Monaco editor mounted');

      editorRef.current = editor;
      monacoRef.current = monaco;

      if (!ydocRef.current || !providerRef.current) {
        console.error('❌ Yjs not initialized when editor mounted');
        return;
      }

      // Create Monaco binding with awareness
      const ytext = providerRef.current.getText();
      const awareness = providerRef.current.getAwareness();

      const binding = new MonacoBinding(
        ytext,
        editor.getModel()!,
        new Set([editor]),
        awareness // Pass awareness for remote cursor rendering
      );

      bindingRef.current = binding;
      console.log('✅ Monaco binding created with awareness');

      // Listen for cursor position changes
      editor.onDidChangeCursorPosition((e) => {
        if (readOnly) return;

        // Send cursor position through OpenAgents
        connection?.sendEvent({
          event_name: 'document.cursor_update',
          destination_id: 'mod:openagents.mods.workspace.documents',
          payload: {
            document_id: documentId,
            position: {
              lineNumber: e.position.lineNumber,
              column: e.position.column,
            },
          },
        }).catch((error) => {
          console.error('❌ Failed to send cursor update:', error);
        });
      });

      // Listen for remote cursor updates
      const handleCursorUpdate = (event: CustomEvent) => {
        const { document_id, agent_id, position } = event.detail;

        if (document_id !== documentId) return;

        setUserCursors((prev) => {
          const filtered = prev.filter((c) => c.agentId !== agent_id);
          return [...filtered, { agentId: agent_id, position }];
        });
      };

      window.addEventListener('document-cursor-update', handleCursorUpdate as EventListener);

      return () => {
        window.removeEventListener('document-cursor-update', handleCursorUpdate as EventListener);
      };
    },
    [connection, documentId, readOnly]
  );

  /**
   * Render remote cursors as Monaco decorations
   */
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const decorations: any[] = [];

    userCursors.forEach((cursor) => {
      const { lineNumber, column } = cursor.position;

      decorations.push({
        range: new monaco.Range(lineNumber, column, lineNumber, column),
        options: {
          className: `remote-cursor remote-cursor-${cursor.agentId.replace(/[^a-zA-Z0-9]/g, '_')}`,
          beforeContentClassName: 'remote-cursor-caret',
          after: {
            content: ` ${cursor.agentId.substring(0, 12)}`,
            inlineClassName: 'remote-cursor-label-text',
          },
        },
      });
    });

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [userCursors]);

  /**
   * Manual save handler
   */
  const handleSave = useCallback(() => {
    if (!providerRef.current) return;

    const content = providerRef.current.getContent();

    if (onSave) {
      onSave(content);
    }

    // Send save event through OpenAgents
    connection?.sendEvent({
      event_name: 'document.save',
      destination_id: 'mod:openagents.mods.workspace.documents',
      payload: {
        document_id: documentId,
        content,
      },
    }).then(() => {
      console.log('✅ Document saved');
      setSyncStatus('synced');
      // Show success toast notification
      toast.success('Document saved successfully');
    }).catch((error) => {
      console.error('❌ Failed to save document:', error);
      setSyncStatus('error');
      // Show error toast notification
      toast.error('Failed to save document');
    });
  }, [connection, documentId, onSave]);

  /**
   * Keyboard shortcut for save (Cmd/Ctrl + S)
   */
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
    <div className="yjs-collaborative-editor relative h-full w-full">
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

        {userCursors.length > 0 && (
          <div className="flex items-center gap-1 border-l border-gray-300 dark:border-gray-600 pl-2">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {userCursors.length} {userCursors.length === 1 ? 'user' : 'users'}
            </span>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={readOnly}
          className="ml-2 px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>

      {/* Monaco Editor */}
      <Editor
        height="100%"
        language={language}
        theme="vs-dark"
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: 'on',
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          tabSize: 2,
        }}
      />

      {/* Remote cursor styles */}
      <style>{`
        .remote-cursor {
          border-left: 2px solid #4CAF50 !important;
          margin-left: -1px;
          pointer-events: none;
        }

        .remote-cursor-caret {
          position: absolute;
          width: 2px;
          height: 1.2em;
          background-color: #4CAF50;
          pointer-events: none;
        }

        .remote-cursor-label-text {
          display: inline-block;
          padding: 1px 4px;
          margin-left: 2px;
          font-size: 10px;
          background-color: #4CAF50;
          color: white;
          border-radius: 2px;
          white-space: nowrap;
          pointer-events: none;
        }

        /* Different colors for different users */
        .remote-cursor-1 .remote-cursor-caret,
        .remote-cursor-1 .remote-cursor-label-text {
          background-color: #4CAF50;
        }

        .remote-cursor-2 .remote-cursor-caret,
        .remote-cursor-2 .remote-cursor-label-text {
          background-color: #2196F3;
        }

        .remote-cursor-3 .remote-cursor-caret,
        .remote-cursor-3 .remote-cursor-label-text {
          background-color: #FF9800;
        }

        .remote-cursor-4 .remote-cursor-caret,
        .remote-cursor-4 .remote-cursor-label-text {
          background-color: #E91E63;
        }

        .remote-cursor-5 .remote-cursor-caret,
        .remote-cursor-5 .remote-cursor-label-text {
          background-color: #9C27B0;
        }
      `}</style>
    </div>
  );
};

export default YjsCollaborativeEditor;
