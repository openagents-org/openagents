import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DocumentContent, DocumentComment, AgentPresence } from '../../types';
import { OpenAgentsConnection } from '../../services/openagentsService';

interface DocumentEditorProps {
  documentId: string;
  connection: OpenAgentsConnection;
  currentTheme: 'light' | 'dark';
  onBack: () => void;
  readOnly?: boolean;
}

interface EditorState {
  content: string[];
  cursorPosition: { line: number; column: number };
  selection: { start: { line: number; column: number }; end: { line: number; column: number } } | null;
  isEditing: boolean;
}

interface CollaborativeUser {
  agentId: string;
  displayName: string;
  cursorPosition: { line: number; column: number };
  color: string;
  isActive: boolean;
}

const DocumentEditor: React.FC<DocumentEditorProps> = ({
  documentId,
  connection,
  currentTheme,
  onBack,
  readOnly = false
}) => {
  // Core state
  const [documentContent, setDocumentContent] = useState<DocumentContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Editor state
  const [editorState, setEditorState] = useState<EditorState>({
    content: [],
    cursorPosition: { line: 1, column: 1 },
    selection: null,
    isEditing: false
  });
  
  // Collaborative features
  const [collaborativeUsers, setCollaborativeUsers] = useState<CollaborativeUser[]>([]);
  const [showComments, setShowComments] = useState(true);
  const [newCommentLine, setNewCommentLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  
  // Refs
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Auto-save delay (ms)
  const AUTO_SAVE_DELAY = 2000;
  
  // User colors for collaborative editing
  const USER_COLORS = [
    '#3B82F6', '#EF4444', '#10B981', '#F59E0B', 
    '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
  ];

  // Load document content
  const loadDocumentContent = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Try to open the document first, but don't fail if it times out
      try {
        await connection.openDocument(documentId);
        console.log('✅ Document opened successfully');
      } catch (openErr) {
        console.warn('⚠️ Failed to open document, but will try to get content anyway:', openErr);
        // Continue anyway - sometimes getDocumentContent works even if openDocument fails
      }
      
      // Get the content (this is the critical part)
      const content = await connection.getDocumentContent(documentId, true, true);
      console.log('📄 Loaded document content:', content);
      
      setDocumentContent(content);
      setEditorState(prev => ({
        ...prev,
        content: content.content || ['']
      }));
      
      // Initialize collaborative users from agent presence
      if (content.agent_presence) {
        const users = content.agent_presence.map((presence: AgentPresence, index: number) => ({
          agentId: presence.agent_id,
          displayName: presence.agent_id,
          cursorPosition: presence.cursor_position || { line: 1, column: 1 },
          color: USER_COLORS[index % USER_COLORS.length],
          isActive: presence.is_active
        }));
        setCollaborativeUsers(users);
      }
      
    } catch (err) {
      console.error('Failed to load document content:', err);
      setError('Failed to load document content');
    } finally {
      setIsLoading(false);
    }
  }, [connection, documentId]);

  useEffect(() => {
    loadDocumentContent();
  }, [loadDocumentContent]);

  // Auto-save functionality
  const saveDocument = useCallback(async () => {
    if (readOnly || !editorState.isEditing) return;
    
    try {
      setIsSaving(true);
      
      // Replace all lines with current content
      await connection.replaceLines(
        documentId, 
        1, 
        documentContent?.content.length || 1, 
        editorState.content
      );
      
      console.log('📄 Document saved successfully');
      setEditorState(prev => ({ ...prev, isEditing: false }));
      
    } catch (err) {
      console.error('Failed to save document:', err);
      // Could add toast notification here
    } finally {
      setIsSaving(false);
    }
  }, [connection, documentId, editorState.content, editorState.isEditing, documentContent, readOnly]);

  // Debounced auto-save
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      saveDocument();
    }, AUTO_SAVE_DELAY);
  }, [saveDocument]);

  // Handle text changes
  const handleContentChange = useCallback((newContent: string) => {
    const lines = newContent.split('\n');
    
    setEditorState(prev => ({
      ...prev,
      content: lines,
      isEditing: true
    }));
    
    // Trigger auto-save
    if (!readOnly) {
      debouncedSave();
    }
  }, [debouncedSave, readOnly]);

  // Handle cursor position changes
  const handleCursorChange = useCallback((line: number, column: number) => {
    setEditorState(prev => ({
      ...prev,
      cursorPosition: { line, column }
    }));
    
    // Update cursor position on server
    connection.updateCursorPosition(documentId, line, column);
  }, [connection, documentId]);

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    
    const textarea = e.currentTarget;
    const { selectionStart, selectionEnd } = textarea;
    const content = textarea.value;
    
    // Calculate line and column from cursor position
    const beforeCursor = content.substring(0, selectionStart);
    const lines = beforeCursor.split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    
    handleCursorChange(line, column);
    
    // Handle special key combinations
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 's':
          e.preventDefault();
          saveDocument();
          break;
        case 'z':
          // Could implement undo/redo here
          break;
      }
    }
  }, [handleCursorChange, saveDocument, readOnly]);

  // Handle mouse clicks for cursor positioning
  const handleClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const { selectionStart } = textarea;
    const content = textarea.value;
    
    const beforeCursor = content.substring(0, selectionStart);
    const lines = beforeCursor.split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    
    handleCursorChange(line, column);
  }, [handleCursorChange]);

  // Comment functionality
  const handleAddComment = useCallback((lineNumber: number) => {
    setNewCommentLine(lineNumber);
    setCommentText('');
    setTimeout(() => {
      commentTextareaRef.current?.focus();
    }, 100);
  }, []);

  const handleSaveComment = useCallback(async () => {
    if (!commentText.trim() || newCommentLine === null) return;
    
    try {
      await connection.addComment(documentId, newCommentLine, commentText.trim());
      setNewCommentLine(null);
      setCommentText('');
      // Reload document to get updated comments
      await loadDocumentContent();
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  }, [connection, documentId, commentText, newCommentLine, loadDocumentContent]);

  const handleCancelComment = useCallback(() => {
    setNewCommentLine(null);
    setCommentText('');
  }, []);

  // Memoized content string for textarea
  const contentString = useMemo(() => {
    return editorState.content.join('\n');
  }, [editorState.content]);

  // Render collaborative cursors
  const renderCollaborativeCursors = useCallback(() => {
    return collaborativeUsers
      .filter(user => user.isActive && user.agentId !== connection.getCurrentAgentId())
      .map(user => (
        <div
          key={user.agentId}
          className="absolute pointer-events-none z-10"
          style={{
            // This would need more sophisticated positioning logic
            // based on line/column to pixel conversion
            top: `${user.cursorPosition.line * 1.5}rem`,
            left: `${user.cursorPosition.column * 0.6}rem`,
          }}
        >
          <div
            className="w-0.5 h-5 animate-pulse"
            style={{ backgroundColor: user.color }}
          />
          <div
            className="absolute -top-6 left-0 px-1 py-0.5 text-xs text-white rounded whitespace-nowrap"
            style={{ backgroundColor: user.color }}
          >
            {user.displayName}
          </div>
        </div>
      ));
  }, [collaborativeUsers, connection]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className={currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
            Loading document...
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
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.864-.833-2.634 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className={`text-lg font-medium mb-2 ${currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
            Failed to load document
          </h3>
          <p className={`${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'} mb-4`}>
            {error}
          </p>
          <button
            onClick={onBack}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Documents
          </button>
        </div>
      </div>
    );
  }

  if (!documentContent) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className={`flex items-center justify-between p-4 border-b ${
        currentTheme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className={`p-2 rounded-lg transition-colors ${
              currentTheme === 'dark' 
                ? 'hover:bg-gray-700 text-gray-300' 
                : 'hover:bg-gray-100 text-gray-600'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div>
            <h1 className={`text-xl font-semibold ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
            }`}>
              {documentContent.document_id}
            </h1>
            <div className="flex items-center space-x-4 text-sm">
              <span className={currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
                Version {documentContent.version}
              </span>
              {isSaving && (
                <span className="text-blue-600 flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-3 w-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              )}
              {editorState.isEditing && !isSaving && (
                <span className="text-orange-600">Unsaved changes</span>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center space-x-2">
          {/* Collaborative users indicator */}
          {collaborativeUsers.length > 0 && (
            <div className="flex items-center space-x-1">
              {collaborativeUsers.slice(0, 3).map((user, index) => (
                <div
                  key={user.agentId}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                  style={{ backgroundColor: user.color }}
                  title={user.displayName}
                >
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
              ))}
              {collaborativeUsers.length > 3 && (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                  currentTheme === 'dark' ? 'bg-gray-600 text-gray-200' : 'bg-gray-300 text-gray-700'
                }`}>
                  +{collaborativeUsers.length - 3}
                </div>
              )}
            </div>
          )}

          {/* Comments toggle */}
          <button
            onClick={() => setShowComments(!showComments)}
            className={`px-3 py-1 rounded-lg text-sm transition-colors ${
              showComments
                ? 'bg-blue-600 text-white'
                : currentTheme === 'dark'
                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Comments ({documentContent.comments?.length || 0})
          </button>

          {/* Save button */}
          {!readOnly && (
            <button
              onClick={saveDocument}
              disabled={!editorState.isEditing || isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Editor */}
        <div className="flex-1 relative">
          {/* Collaborative cursors overlay */}
          <div className="absolute inset-0 pointer-events-none z-10">
            {renderCollaborativeCursors()}
          </div>

          {/* Text Editor */}
          <textarea
            ref={editorRef}
            value={contentString}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={handleClick}
            readOnly={readOnly}
            className={`w-full h-full p-4 resize-none font-mono text-sm leading-6 focus:outline-none ${
              currentTheme === 'dark'
                ? 'bg-gray-900 text-gray-200 placeholder-gray-500'
                : 'bg-white text-gray-800 placeholder-gray-400'
            }`}
            placeholder={readOnly ? "This document is read-only" : "Start typing..."}
            spellCheck={false}
          />

          {/* Line numbers (optional) */}
          <div className={`absolute left-0 top-0 bottom-0 w-12 p-4 pt-4 text-right text-xs font-mono leading-6 select-none pointer-events-none ${
            currentTheme === 'dark' ? 'text-gray-500 bg-gray-800' : 'text-gray-400 bg-gray-50'
          }`}>
            {editorState.content.map((_, index) => (
              <div key={index + 1}>{index + 1}</div>
            ))}
          </div>
        </div>

        {/* Comments Sidebar */}
        {showComments && (
          <div className={`w-80 border-l overflow-y-auto ${
            currentTheme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          }`}>
            <div className="p-4">
              <h3 className={`font-medium mb-4 ${
                currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
              }`}>
                Comments
              </h3>

              {/* Add comment form */}
              {newCommentLine !== null && (
                <div className={`mb-4 p-3 rounded-lg ${
                  currentTheme === 'dark' ? 'bg-gray-700' : 'bg-blue-50'
                }`}>
                  <div className="text-sm mb-2">
                    Adding comment to line {newCommentLine}
                  </div>
                  <textarea
                    ref={commentTextareaRef}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment..."
                    className={`w-full p-2 text-sm border rounded resize-none ${
                      currentTheme === 'dark'
                        ? 'bg-gray-800 border-gray-600 text-gray-200 placeholder-gray-400'
                        : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'
                    }`}
                    rows={3}
                  />
                  <div className="flex justify-end space-x-2 mt-2">
                    <button
                      onClick={handleCancelComment}
                      className={`px-3 py-1 text-sm rounded transition-colors ${
                        currentTheme === 'dark'
                          ? 'bg-gray-600 text-gray-200 hover:bg-gray-500'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveComment}
                      disabled={!commentText.trim()}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Comment
                    </button>
                  </div>
                </div>
              )}

              {/* Existing comments */}
              <div className="space-y-3">
                {documentContent.comments?.map((comment: DocumentComment) => (
                  <div
                    key={comment.comment_id}
                    className={`p-3 rounded-lg ${
                      currentTheme === 'dark' ? 'bg-gray-700' : 'bg-white border border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm font-medium">
                        Line {comment.line_number}
                      </div>
                      <div className={`text-xs ${
                        currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        {comment.agent_id}
                      </div>
                    </div>
                    <p className={`text-sm ${
                      currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      {comment.comment_text}
                    </p>
                    <div className={`text-xs mt-2 ${
                      currentTheme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      {new Date(comment.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick add comment button */}
              {!readOnly && newCommentLine === null && (
                <button
                  onClick={() => handleAddComment(editorState.cursorPosition.line)}
                  className="w-full mt-4 px-4 py-2 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-blue-400 hover:text-blue-600 transition-colors"
                >
                  Add comment to current line
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className={`px-4 py-2 border-t text-sm ${
        currentTheme === 'dark' 
          ? 'bg-gray-800 border-gray-700 text-gray-400' 
          : 'bg-gray-50 border-gray-200 text-gray-600'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span>
              Line {editorState.cursorPosition.line}, Column {editorState.cursorPosition.column}
            </span>
            <span>
              {editorState.content.length} lines, {contentString.length} characters
            </span>
          </div>
          <div className="flex items-center space-x-4">
            {readOnly && <span className="text-orange-600">Read Only</span>}
            <span>
              {collaborativeUsers.filter(u => u.isActive).length} active users
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentEditor;
