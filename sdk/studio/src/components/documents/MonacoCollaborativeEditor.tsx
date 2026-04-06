import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import { useThemeStore } from "@/stores/themeStore";
import { useDocumentStore } from "@/stores/documentStore";

interface MonacoCollaborativeEditorProps {
  documentId: string;
  initialContent?: string;
  initialVersion?: number;
  language?: string;
  readOnly?: boolean;
  onSave?: (content: string) => void;
}



interface UserCursor {
  agentId: string;
  line: number;
  column: number;
  color: string;
}

const MonacoCollaborativeEditor: React.FC<MonacoCollaborativeEditorProps> = ({
  documentId,
  initialContent = "",
  initialVersion = 1,
  language = "typescript",
  readOnly = false,
  onSave,
}) => {
  const { theme } = useThemeStore();
  const monaco = useMonaco();
  const editorRef = useRef<any>(null);
  // User color mapping
  const userColorsRef = useRef<Map<string, string>>(new Map());
  const USER_COLORS = useMemo(() => [
    "#3B82F6", // blue
    "#EF4444", // red
    "#10B981", // green
    "#F59E0B", // amber
    "#8B5CF6", // purple
    "#EC4899", // pink
    "#06B6D4", // cyan
    "#84CC16", // lime
  ], []);

  // Get color for user
  const getUserColor = useCallback((agentId: string): string => {
    if (!userColorsRef.current.has(agentId)) {
      const colorIndex =
        userColorsRef.current.size % USER_COLORS.length;
      userColorsRef.current.set(agentId, USER_COLORS[colorIndex]);
    }
    return userColorsRef.current.get(agentId)!;
  }, [USER_COLORS]);

  // Get documentStore methods
  const { updateCursor: updateCursorInStore, getDocument, saveDocumentContent } = useDocumentStore();

  // State
  const [content, setContent] = useState(initialContent);
  // Remove unused version state
  const [userCursors, setUserCursors] = useState<UserCursor[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);
  const [lastEditTime, setLastEditTime] = useState<Date | null>(null);  // Track last edit time
  const [isApplyingRemoteEdit, setIsApplyingRemoteEdit] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "conflict" | "checking">("synced");

  // Refs for timers
  const editDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cursorThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const syncCheckTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Previous content for diff calculation
  const previousContentRef = useRef(initialContent);

  // Decorations for remote cursors
  const decorationsRef = useRef<string[]>([]);

  // Last sync check timestamp
  const lastSyncCheckRef = useRef<number>(Date.now());

  // ... (rest of the file content until useEffect cleanup)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (cursorThrottleRef.current) clearTimeout(cursorThrottleRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (syncCheckTimerRef.current) clearInterval(syncCheckTimerRef.current);
    };
  }, []);



  // Periodic sync check to ensure content consistency
  const performSyncCheck = useCallback(async () => {
    if (!editorRef.current || isApplyingRemoteEdit || isSaving) {
      return; // Skip if editor not ready or already syncing
    }

    try {
      const now = Date.now();
      const timeSinceLastCheck = now - lastSyncCheckRef.current;

      // Only check if it's been at least 120 seconds (increased from 30)
      if (timeSinceLastCheck < 120000) {
        return;
      }

      lastSyncCheckRef.current = now;
      setSyncStatus("checking");

      console.log("🔄 Performing periodic sync check...");

      // Fetch latest document from server
      const serverDoc = await getDocument(documentId);
      if (!serverDoc) {
        console.log("⚠️ No response from server, skipping sync check");
        setSyncStatus("synced");
        return;
      }

      const localContent = editorRef.current.getModel()?.getValue() || content;
      const serverContent = serverDoc.content || "";

      // 🛡️ PROTECTION: If local has content but server is empty, save local content first
      if (localContent.length > 0 && serverContent.length === 0) {
        console.log("🛡️ Local has content but server is empty - saving local content to prevent data loss");
        setSyncStatus("syncing");
        try {
          await saveDocumentContent(documentId, localContent);
          setSyncStatus("synced");
        } catch (error) {
          console.error("❌ Failed to save local content:", error);
          setSyncStatus("conflict");
        }
        return;
      }

      // Check if content differs
      if (localContent !== serverContent) {
        console.log("⚠️ Content mismatch detected! Local and server out of sync");
        console.log(`Local length: ${localContent.length}, Server length: ${serverContent.length}`);
        setSyncStatus("conflict");

        // Use lastEditTime instead of lastSaveTime for better accuracy
        const timeSinceLastEdit = Date.now() - (lastEditTime?.getTime() || 0);
        const isActivelyEditing = timeSinceLastEdit < 10000; // Increased to 10 seconds

        if (!isActivelyEditing) {
          // Safe to sync - user has been idle for 10+ seconds
          console.log("🔄 User idle for 10+ seconds, applying server content");
          setSyncStatus("syncing");
          setIsApplyingRemoteEdit(true);

          try {
            const model = editorRef.current.getModel();
            if (model) {
              const currentPosition = editorRef.current.getPosition();
              const fullRange = model.getFullModelRange();

              model.pushEditOperations(
                [],
                [{ range: fullRange, text: serverContent }],
                () => null
              );

              // Restore cursor
              if (currentPosition) {
                const maxLine = model.getLineCount();
                const maxColumn = model.getLineMaxColumn(Math.min(currentPosition.lineNumber, maxLine));
                editorRef.current.setPosition({
                  lineNumber: Math.min(currentPosition.lineNumber, maxLine),
                  column: Math.min(currentPosition.column, maxColumn),
                });
              }

              setContent(serverContent);
              previousContentRef.current = serverContent;
              console.log("✅ Sync completed successfully");
              setSyncStatus("synced");
            }
          } finally {
            setTimeout(() => setIsApplyingRemoteEdit(false), 50);
          }
        } else {
          console.log("⏭️ User actively editing (last edit < 10s ago), deferring sync");
          // Keep conflict status visible
        }
      } else {
        console.log("✅ Content in sync");
        setSyncStatus("synced");
      }
    } catch (error) {
      console.error("❌ Error during sync check:", error);
      setSyncStatus("synced"); // Reset to avoid stuck state
    }
  }, [documentId, content, isApplyingRemoteEdit, isSaving, lastEditTime, getDocument, saveDocumentContent]);

  // Debounced auto-save function
  const debouncedSave = useCallback(
    async (contentToSave: string) => {
      if (isSaving || readOnly) return;

      setIsSaving(true);
      setSyncStatus("syncing");

      try {
        console.log("💾 Auto-saving document...", contentToSave.length, "characters");

        const success = await saveDocumentContent(documentId, contentToSave);

        if (success) {
          setLastSaveTime(new Date());
          setSyncStatus("synced");
          console.log("✅ Document saved successfully");

          // Update cursor position
          if (editorRef.current) {
            const position = editorRef.current.getPosition();
            if (position) {
              updateCursorInStore(
                documentId,
                position.lineNumber - 1,
                position.column - 1
              );
            }
          }
        } else {
          setSyncStatus("conflict");
          console.error("❌ Failed to save document");
        }
      } catch (error) {
        console.error("❌ Save error:", error);
        setSyncStatus("conflict");
      } finally {
        setIsSaving(false);
      }
    },
    [documentId, isSaving, readOnly, saveDocumentContent, updateCursorInStore]
  );

  // Handle content change - simplified version
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || readOnly) return;

      // Skip if we're applying remote edits to avoid feedback loop
      if (isApplyingRemoteEdit) {
        console.log("⏭️ Skipping onChange during remote edit application");
        return;
      }

      const newContent = value;
      setContent(newContent);
      previousContentRef.current = newContent;

      // Update last edit time - important for detecting active editing
      setLastEditTime(new Date());

      // Clear previous save timer
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      // Schedule auto-save after 2.5 seconds of inactivity
      saveTimerRef.current = setTimeout(() => {
        debouncedSave(newContent);
      }, 2500);
    },
    [readOnly, isApplyingRemoteEdit, debouncedSave]
  );

  // Handle save
  const handleSave = useCallback(async () => {
    if (isSaving) return;

    setIsSaving(true);
    console.log("💾 Saving document:", documentId);

    try {
      // TODO: Call document.save API
      if (onSave) {
        onSave(content);
      }
      setLastSaveTime(new Date());
      console.log("✅ Document saved");
    } catch (error) {
      console.error("❌ Failed to save document:", error);
    } finally {
      setIsSaving(false);
    }
  }, [documentId, content, onSave, isSaving]);

  // Handle cursor position change
  const handleCursorPositionChange = useCallback(() => {
    if (!editorRef.current || readOnly) return;

    const position = editorRef.current.getPosition();
    if (!position) return;

    // Throttled send cursor update (reduced from 1000ms to 300ms for more responsive updates)
    if (cursorThrottleRef.current) return;

    cursorThrottleRef.current = setTimeout(() => {
      const line = position.lineNumber - 1; // Convert to 0-based
      const column = position.column - 1;
      console.log("👆 Cursor moved:", { line, column });
      updateCursorInStore(documentId, line, column);
      cursorThrottleRef.current = null;
    }, 300); // Reduced throttle time for more responsive cursor updates
  }, [documentId, readOnly, updateCursorInStore]);

  // Handle editor mount
  const handleEditorDidMount = useCallback((editor: any, monaco: any) => {
    editorRef.current = editor;

    // Listen to cursor position changes
    editor.onDidChangeCursorPosition(() => {
      handleCursorPositionChange();
    });

    // Focus editor
    editor.focus();
  }, [handleCursorPositionChange]);

  // Apply remote save with smart merging
  const applyRemoteSave = useCallback((remoteContent: string, sourceAgentId: string) => {
    if (!editorRef.current || !monaco) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    const localContent = model.getValue();

    // Skip if content is the same
    if (localContent === remoteContent) {
      console.log("⏭️ Content unchanged, skipping update");
      return;
    }

    console.log("📥 Applying remote save from:", sourceAgentId);

    // Use lastEditTime to detect if user is actively typing (more accurate)
    const timeSinceLastEdit = Date.now() - (lastEditTime?.getTime() || 0);
    const isActivelyTyping = timeSinceLastEdit < 2000; // User typed within last 2 seconds

    if (isActivelyTyping) {
      console.log("⏭️ User actively typing (last edit < 2s ago), deferring remote update");
      // Store for later application or skip to avoid disruption
      return;
    }

    // Set lock to prevent onChange feedback loop
    setIsApplyingRemoteEdit(true);

    try {
      // Save current cursor position
      const currentPosition = editor.getPosition();

      // Apply remote content
      const fullRange = model.getFullModelRange();
      model.pushEditOperations(
        [],
        [{ range: fullRange, text: remoteContent }],
        () => null
      );

      // Restore cursor position (best effort)
      if (currentPosition) {
        const maxLine = model.getLineCount();
        const safeLineNumber = Math.min(currentPosition.lineNumber, maxLine);
        const maxColumn = model.getLineMaxColumn(safeLineNumber);
        const safeColumn = Math.min(currentPosition.column, maxColumn);

        editor.setPosition({
          lineNumber: safeLineNumber,
          column: safeColumn,
        });
      }

      // Update state
      setContent(remoteContent);
      previousContentRef.current = remoteContent;

      console.log("✅ Remote save applied successfully");
    } catch (error) {
      console.error("❌ Error applying remote save:", error);
    } finally {
      setTimeout(() => {
        setIsApplyingRemoteEdit(false);
      }, 50);
    }
  }, [monaco, lastEditTime]);

  // Render user cursors as Monaco decorations
  useEffect(() => {
    if (!editorRef.current || !monaco) {
      return;
    }

    const editor = editorRef.current;
    const decorations: any[] = [];

    // Only add decorations if there are cursors to show
    if (userCursors.length > 0) {
      userCursors.forEach((cursor) => {
        const position = {
          lineNumber: cursor.line + 1, // Monaco uses 1-based
          column: cursor.column + 1,
        };

        // Cursor decoration with colored border and label
        decorations.push({
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column
          ),
          options: {
            className: `remote-cursor remote-cursor-${cursor.agentId.replace(/[^a-zA-Z0-9]/g, '_')}`,
            stickiness: 1,
            hoverMessage: { value: `**${cursor.agentId}** is editing here` },
            beforeContentClassName: "remote-cursor-caret",
            afterContentClassName: "remote-cursor-label",
            after: {
              content: ` ${cursor.agentId.substring(0, 12)}`,
              inlineClassName: "remote-cursor-label-text",
              inlineClassNameAffectsLetterSpacing: false,
            },
            zIndex: 1000,
          },
        });

        // Add cursor line highlight
        decorations.push({
          range: new monaco.Range(
            position.lineNumber,
            1,
            position.lineNumber,
            1
          ),
          options: {
            isWholeLine: true,
            className: `remote-cursor-line remote-cursor-line-${cursor.agentId.replace(/[^a-zA-Z0-9]/g, '_')}`,
            zIndex: 0,
          },
        });
      });
    }

    // Update decorations, clearing old ones
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);

    console.log(`🎨 Updated ${decorations.length / 2} remote cursors`, userCursors);
  }, [userCursors, monaco]);

  // Listen to remote document saves
  useEffect(() => {
    const handleDocumentSaved = (event: any) => {
      const detail = event.detail;
      if (!detail || !detail.document) return;

      const doc = detail.document;
      if (doc.document_id !== documentId) return;

      console.log("📥 Received document.saved event:", detail);

      // Get current agent ID
      const currentAgentId = localStorage.getItem('agent_id') || 'unknown';
      const sourceAgentId = detail.source_agent_id || doc.last_editor;

      // Skip if this is our own save
      if (sourceAgentId === currentAgentId) {
        console.log("⏭️ Skipping own save event");
        return;
      }

      // Apply remote save
      if (doc.content !== undefined) {
        applyRemoteSave(doc.content, sourceAgentId);
      }

      // Update cursors if provided - filter out current user's cursor
      if (doc.cursor_positions) {
        const cursors: UserCursor[] = Object.entries(doc.cursor_positions)
          .filter(([agentId]) => agentId !== currentAgentId)
          .map(([agentId, pos]: [string, any]) => ({
            agentId,
            line: pos.line,
            column: pos.column,
            color: getUserColor(agentId),
          }));

        console.log(`📍 Updating ${cursors.length} remote cursors:`, cursors);
        setUserCursors(cursors);
      }
    };

    const handleCursorUpdated = (event: any) => {
      const detail = event.detail;
      if (!detail || !detail.document) return;

      const doc = detail.document;
      if (doc.document_id !== documentId) return;

      console.log("📍 Received cursor update event:", detail);

      // Update cursors - filter out current user's cursor
      if (doc.cursor_positions) {
        const cursors: UserCursor[] = Object.entries(doc.cursor_positions)
          .filter(([agentId]) => {
            // Filter out current user's cursor to avoid showing our own cursor
            const currentAgentId = localStorage.getItem('agent_id') || 'unknown';
            return agentId !== currentAgentId;
          })
          .map(([agentId, pos]: [string, any]) => ({
            agentId,
            line: pos.line,
            column: pos.column,
            color: getUserColor(agentId),
          }));

        console.log(`📍 Updating ${cursors.length} remote cursors:`, cursors);
        setUserCursors(cursors);
      }
    };

    window.addEventListener("document-saved", handleDocumentSaved);
    window.addEventListener("document-cursor-updated", handleCursorUpdated);

    return () => {
      window.removeEventListener("document-saved", handleDocumentSaved);
      window.removeEventListener("document-cursor-updated", handleCursorUpdated);
    };
  }, [documentId, getUserColor, applyRemoteSave]);

  // Set up periodic sync check
  useEffect(() => {
    // Start periodic sync check (every 120 seconds / 2 minutes)
    const startSyncCheck = () => {
      syncCheckTimerRef.current = setInterval(() => {
        performSyncCheck();
      }, 120000); // Check every 120 seconds (2 minutes)
    };

    // Start after initial delay of 2 minutes
    const initialDelay = setTimeout(startSyncCheck, 120000);

    return () => {
      clearTimeout(initialDelay);
      if (syncCheckTimerRef.current) {
        clearInterval(syncCheckTimerRef.current);
      }
    };
  }, [performSyncCheck]);



  return (
    <div className="h-full flex flex-col">
      {/* Remote cursor styles */}
      <style>{`
        /* Remote cursor caret */
        .remote-cursor-caret {
          border-left: 2px solid var(--cursor-color, #3B82F6) !important;
          position: relative;
          animation: cursor-blink 1s infinite;
        }

        /* Remote cursor label */
        .remote-cursor-label-text {
          background-color: var(--cursor-color, #3B82F6) !important;
          color: white !important;
          padding: 2px 6px !important;
          border-radius: 3px !important;
          font-size: 11px !important;
          font-weight: 500 !important;
          margin-left: 4px !important;
          white-space: nowrap !important;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
          z-index: 1000 !important;
        }

        /* Remote cursor line highlight */
        .remote-cursor-line {
          background-color: var(--cursor-color-light, rgba(59, 130, 246, 0.1)) !important;
          border-left: 2px solid var(--cursor-color, #3B82F6) !important;
        }

        /* Cursor blink animation */
        @keyframes cursor-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }

        /* User-specific colors */
        ${userCursors.map((cursor, idx) => {
        const color = cursor.color;
        const colorLight = `${color}20`;
        const safeName = cursor.agentId.replace(/[^a-zA-Z0-9]/g, '_');
        return `
            .remote-cursor-${safeName} .remote-cursor-caret {
              border-left-color: ${color} !important;
            }
            .remote-cursor-${safeName} .remote-cursor-label-text {
              background-color: ${color} !important;
            }
            .remote-cursor-line-${safeName} {
              background-color: ${colorLight} !important;
              border-left-color: ${color} !important;
            }
          `;
      }).join('\n')}
      `}</style>

      {/* Toolbar */}
      <div
        className={`flex items-center justify-between px-4 py-2 border-b ${theme === "dark" ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"
          }`}
      >
        <div className="flex items-center space-x-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-3 py-1 text-sm rounded ${isSaving
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
              } text-white`}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          {lastSaveTime && (
            <span
              className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-600"
                }`}
            >
              Last saved: {lastSaveTime.toLocaleTimeString()}
            </span>
          )}

          {/* Sync status indicator */}
          <div className="flex items-center space-x-2">
            {syncStatus === "synced" && (
              <div className="flex items-center space-x-1 text-xs text-green-500">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Synced</span>
              </div>
            )}

            {syncStatus === "syncing" && (
              <div className="flex items-center space-x-1 text-xs text-blue-500">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Syncing...</span>
              </div>
            )}

            {syncStatus === "checking" && (
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                <span>Checking...</span>
              </div>
            )}

            {syncStatus === "conflict" && (
              <div className="flex items-center space-x-1 text-xs text-orange-500">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>Conflict</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1">
        <Editor
          height="100%"
          language={language}
          theme={theme === "dark" ? "vs-dark" : "vs-light"}
          value={content}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            readOnly,
            minimap: { enabled: true },
            fontSize: 14,
            lineNumbers: "on",
            renderWhitespace: "selection",
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
};

export default MonacoCollaborativeEditor;
