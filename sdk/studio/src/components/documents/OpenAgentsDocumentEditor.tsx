import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DocumentContent, DocumentComment, AgentPresence } from '../../types';
import { Button } from '@/components/layout/ui/button';
// TODO: Implement with HTTP event system

interface OpenAgentsDocumentEditorProps {
  documentId: string;
  connection: any; // TODO: HTTP event connector
  currentTheme: 'light' | 'dark';
  onBack: () => void;
  readOnly?: boolean;
}

interface CollaborativeUser {
  userId: string;
  displayName: string;
  cursor: { line: number; column: number } | null;
  color: string;
  isActive: boolean;
  lastSeen: number;
}

const OpenAgentsDocumentEditor: React.FC<OpenAgentsDocumentEditorProps> = ({
  documentId,
  connection,
  currentTheme,
  onBack,
  readOnly = false
}) => {
  const { t } = useTranslation('documents');
  // Core state
  const [documentContent, setDocumentContent] = useState<DocumentContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [collaborativeUsers, setCollaborativeUsers] = useState<CollaborativeUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [liveUpdateIndicator, setLiveUpdateIndicator] = useState(false);
  
  // Content state
  const [textContent, setTextContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<number>(0);
  
  // Line authorship tracking
  const [lineAuthors, setLineAuthors] = useState<{[lineNumber: number]: string}>({});
  
  // Line locking tracking
  const [lineLocks, setLineLocks] = useState<{[lineNumber: number]: string}>({});
  
  // Refs
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Configuration
  const SYNC_INTERVAL = 1000; // Poll every 1 second for real-time collaboration
  const SAVE_DEBOUNCE = 500; // Wait 500ms after typing stops to save (faster sync)
  const PRESENCE_UPDATE_INTERVAL = 5000; // Update presence every 5 seconds

  // User colors for collaborative editing
  const USER_COLORS = useMemo(() => [
    '#3B82F6', '#EF4444', '#10B981', '#F59E0B', 
    '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
  ], []);
  
  // Get author color and info
  const getAuthorInfo = useCallback((agentId: string) => {
    const colorIndex = Math.abs(agentId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % USER_COLORS.length;
    const color = USER_COLORS[colorIndex];
    const initials = agentId.length >= 2 ? agentId.substring(0, 2).toUpperCase() : agentId.toUpperCase();
    return { color, initials, agentId };
  }, [USER_COLORS]);

  // Handle document content received via events
  const handleDocumentContentReceived = useCallback((content: any) => {
    console.log('📄 Document content received via event:', content);
    console.log('📄 Content structure:', {
      hasContent: !!content.content,
      contentType: typeof content.content,
      contentIsArray: Array.isArray(content.content),
      contentLength: content.content?.length,
      keys: Object.keys(content),
      actualContent: content.content,
      firstLine: content.content?.[0],
      allLines: content.content
    });

    // Check if content is in the expected format
    let newTextContent = '';

    if (content.content && Array.isArray(content.content)) {
      // Standard format: content is array of lines
      console.log('📄 Raw content array:', content.content);
      console.log('📄 Array items:', content.content.map((line: string, i: number) => `[${i}]: "${line}"`));

      // Filter out empty strings if the array only contains empty strings
      const filteredContent = content.content.filter((line: string) => line !== '');
      if (filteredContent.length === 0 && content.content.length > 0) {
        // All lines are empty strings, this might be a new document
        newTextContent = '';
      } else {
        newTextContent = content.content.join('\n');
      }
    } else if (content.data && content.data.content && Array.isArray(content.data.content)) {
      // Nested format: content is in data.content
      newTextContent = content.data.content.join('\n');
    } else if (typeof content.content === 'string') {
      // String format: content is already a string
      newTextContent = content.content;
    } else if (content.data && typeof content.data.content === 'string') {
      // Nested string format
      newTextContent = content.data.content;
    } else {
      console.warn('⚠️ Content not in expected format:', content);
      return; // Exit early if we can't parse the content
    }

    console.log(`📄 Processing content: "${newTextContent}"`);

    // Smart live collaboration: Allow updates but protect active typing
    const isCurrentlyEditing = document.activeElement === textareaRef.current;
    const hasUnsavedWork = hasUnsavedChanges;
    const recentlySaved = Date.now() - lastSaveTime < 2000; // 2 seconds grace period after save

    // Update logic:
    // 1. Update if not currently editing AND not saving AND no unsaved work
    // 2. NEVER update if user has unsaved changes and is actively typing
    // 3. Give user 2 seconds grace period after saving to continue typing
    const shouldUpdate = (!isCurrentlyEditing && !isSaving && !hasUnsavedWork && !recentlySaved);

    console.log(`📄 Update decision: editing=${isCurrentlyEditing}, saving=${isSaving}, unsaved=${hasUnsavedChanges}, recentSave=${recentlySaved}, shouldUpdate=${shouldUpdate}`);

    if (shouldUpdate) {
      // Preserve cursor position during live updates (Notion-style)
      let cursorPosition = 0;
      let selectionEnd = 0;
      if (textareaRef.current && isCurrentlyEditing) {
        cursorPosition = textareaRef.current.selectionStart || 0;
        selectionEnd = textareaRef.current.selectionEnd || 0;
      }
      
      setTextContent(newTextContent);

      if (textareaRef.current) {
        textareaRef.current.value = newTextContent;

        // Restore cursor position if user was editing
        if (isCurrentlyEditing && cursorPosition >= 0) {
          // Ensure cursor position is within bounds of new content
          const safeStart = Math.min(cursorPosition, newTextContent.length);
          const safeEnd = Math.min(selectionEnd, newTextContent.length);
          textareaRef.current.setSelectionRange(safeStart, safeEnd);
          console.log(`🎯 Restored cursor position: ${safeStart}-${safeEnd}`);
        }
      }

      setLastSyncTime(new Date());
      console.log(`✅ Live collaboration update`);

      // Show live update indicator briefly (only for updates from other users)
      if (isCurrentlyEditing && !isSaving) {
        setLiveUpdateIndicator(true);
        setTimeout(() => setLiveUpdateIndicator(false), 1500);
      }

      // Only clear unsaved changes if this isn't a user's active edit
      if (!isCurrentlyEditing || !hasUnsavedChanges) {
        setHasUnsavedChanges(false);
      }

      // Update line authorship from backend data
      if (content.line_authors && typeof content.line_authors === 'object') {
        console.log('📝 Updating line authorship:', content.line_authors);
        setLineAuthors(content.line_authors);
      } else {
        // Fallback: if no line authorship data, clear existing authorship
        console.log('⚠️ No line authorship data received, clearing authorship');
        setLineAuthors({});
      }

      // Update line locks from backend data
      if (content.line_locks && typeof content.line_locks === 'object') {
        console.log('🔒 Updating line locks:', content.line_locks);
        setLineLocks(content.line_locks);
      } else {
        // Clear existing locks if no lock data received
        setLineLocks({});
      }
    } else {
      console.log(`⏭️ Skipping update - currently saving`);
    }
    
    setDocumentContent(content);
    setTitle(content.document_id || documentId);
    
    // Update collaborative users from agent presence
    if (content.agent_presence && Array.isArray(content.agent_presence)) {
      const users: CollaborativeUser[] = content.agent_presence
        .filter((presence: AgentPresence) => presence.agent_id !== 'current_user') // Filter out current user
        .map((presence: AgentPresence, index: number) => ({
          userId: presence.agent_id,
          displayName: presence.agent_id,
          cursor: presence.cursor_position ? {
            line: presence.cursor_position.line_number,
            column: presence.cursor_position.column_number
          } : null,
          color: USER_COLORS[index % USER_COLORS.length],
          isActive: presence.is_active,
          lastSeen: new Date(presence.last_activity).getTime()
        }));
      
      setCollaborativeUsers(users);
    }
    
    setIsLoading(false);
    setConnectionStatus('connected');
  }, [documentId, USER_COLORS, hasUnsavedChanges, isSaving, lastSaveTime]);

  // Save content to OpenAgents
  const saveContent = useCallback(async (content: string) => {
    try {
      setIsSaving(true);
      console.log('💾 Saving content to OpenAgents...', `"${content}"`);
      const lines = content.split('\n');
      
      // The replaceLines method expects the content as a string, but the backend
      // might expect it as an array of lines. Let's check both formats.
      console.log('💾 Saving as lines:', lines);
      
      // Use replaceLines to update the entire document
      // Backend expects 1-based line numbers, so we use 1 to lines.length
      console.log(`💾 Replacing lines 1 to ${lines.length} with ${lines.length} lines`);
      await connection.replaceLines(documentId, 1, lines.length, content);
      
      // Update line authorship for all modified lines
      // The backend will track authorship, but we can optimistically update the UI
      // Note: The real authorship will come from the next content update from the server

      setHasUnsavedChanges(false);
      setLastSaveTime(Date.now()); // Record save time for grace period
      console.log('✅ Content saved successfully');
      
    } catch (error) {
      console.error('❌ Failed to save content:', error);
      setError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [connection, documentId]);

  // Handle text changes
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    console.log(`📝 Text changed: "${newContent}" (length: ${newContent.length})`);
    setTextContent(newContent);
    setHasUnsavedChanges(true);
    
    // Clear existing save timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      console.log('⏰ Cleared previous save timeout');
    }
    
    // Set new save timeout (debounced save)
    saveTimeoutRef.current = setTimeout(() => {
      console.log(`💾 Triggering debounced save for: "${newContent}"`);
      saveContent(newContent);
    }, SAVE_DEBOUNCE);
    console.log(`⏰ Set save timeout for ${SAVE_DEBOUNCE}ms`);
    
  }, [saveContent]);

  // Update cursor position for presence (placeholder for future implementation)
  const updateCursorPosition = useCallback(async () => {
    // TODO: Implement cursor position updates when public API is available
    // For now, this is a placeholder to maintain the interface
  }, []);

  // Load document content
  const loadDocumentContent = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setConnectionStatus('connecting');
      
      console.log('📖 Loading document:', documentId);
      
      // Request document content - this will trigger 'document_content' events
      const result = await connection.getDocumentContent(documentId, true, true);
      console.log('📤 Document content requested:', result);
      
    } catch (error) {
      console.error('Failed to load document:', error);
      setError('Failed to load document. Please try again.');
      setIsLoading(false);
      setConnectionStatus('disconnected');
    }
  }, [connection, documentId]);

  // Poll for document updates
  const pollForUpdates = useCallback(async () => {
    try {
      await connection.getDocumentContent(documentId, false, true); // Get content with presence
    } catch (error) {
      console.warn('Polling failed:', error);
      setConnectionStatus('disconnected');
    }
  }, [connection, documentId]);

  // Update presence (placeholder for future implementation)
  const updatePresence = useCallback(async () => {
    // TODO: Implement presence updates when public API is available
    // For now, presence is updated via document content polling
  }, []);

  // Title editing handlers
  const handleTitleClick = () => {
    if (!readOnly) {
      setIsEditingTitle(true);
      setTimeout(() => titleRef.current?.focus(), 0);
    }
  };

  const handleTitleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditingTitle(false);
    // TODO: Implement title saving to OpenAgents
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setTitle(documentContent?.document_id || documentId);
    }
  };

  // Set up event listeners
  useEffect(() => {
    connection.on('document_content', handleDocumentContentReceived);
    
    return () => {
      connection.off('document_content', handleDocumentContentReceived);
    };
  }, [connection, handleDocumentContentReceived]);

  // Load document when component mounts
  useEffect(() => {
    loadDocumentContent();
  }, [loadDocumentContent]);

  // Set up polling for real-time updates
  useEffect(() => {
    console.log('🔄 POLLING RE-ENABLED - Testing fix for line number indexing');
    pollIntervalRef.current = setInterval(pollForUpdates, SYNC_INTERVAL);
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [pollForUpdates]);

  // Set up presence updates
  useEffect(() => {
    const presenceInterval = setInterval(updatePresence, PRESENCE_UPDATE_INTERVAL);
    
    return () => {
      clearInterval(presenceInterval);
    };
  }, [updatePresence]);

  // Update cursor position on selection change
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const handleSelectionChange = () => {
      updateCursorPosition();
    };
    
    textarea.addEventListener('selectionchange', handleSelectionChange);
    textarea.addEventListener('click', handleSelectionChange);
    textarea.addEventListener('keyup', handleSelectionChange);
    
    return () => {
      textarea.removeEventListener('selectionchange', handleSelectionChange);
      textarea.removeEventListener('click', handleSelectionChange);
      textarea.removeEventListener('keyup', handleSelectionChange);
    };
  }, [updateCursorPosition]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const syncTimeout = syncTimeoutRef.current;
      const saveTimeout = saveTimeoutRef.current;
      const pollInterval = pollIntervalRef.current;
      if (syncTimeout) clearTimeout(syncTimeout);
      if (saveTimeout) clearTimeout(saveTimeout);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Manual refresh
  const handleRefresh = async () => {
    setConnectionStatus('connecting');
    await loadDocumentContent();
  };

  if (isLoading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${currentTheme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p>Loading document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex-1 flex items-center justify-center ${currentTheme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-lg font-medium mb-2">Error Loading Document</p>
          <p className="text-sm opacity-75 mb-4">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Custom CSS for enhanced cursor and typography */}
      <style>{`
        .enhanced-editor {
          caret-color: #60A5FA !important;
          transition: all 0.2s ease;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          line-height: 1.6 !important;
          border-radius: 0;
        }
        
        .enhanced-editor:focus {
          caret-color: #3B82F6 !important;
          box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.2);
          animation: cursor-pulse 1.2s ease-in-out infinite;
        }
        
        /* Better text selection with light blue theme */
        .enhanced-editor::selection {
          background-color: rgba(96, 165, 250, 0.25);
          color: inherit;
        }
        
        .enhanced-editor::-moz-selection {
          background-color: rgba(96, 165, 250, 0.25);
          color: inherit;
        }
        
        /* Dark mode adjustments */
        .enhanced-editor.dark-mode::selection {
          background-color: rgba(96, 165, 250, 0.4);
        }
        
        .enhanced-editor.dark-mode::-moz-selection {
          background-color: rgba(96, 165, 250, 0.4);
        }
        
        /* Enhanced cursor visibility */
        @keyframes cursor-pulse {
          0%, 50% { 
            caret-color: #60A5FA; 
          }
          51%, 100% { 
            caret-color: rgba(96, 165, 250, 0.3); 
          }
        }
        
        /* Better placeholder styling */
        .enhanced-editor::placeholder {
          font-style: italic;
          opacity: 0.6;
        }
      `}</style>
      
      <div className={`flex-1 flex flex-col ${currentTheme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between p-4 border-b ${currentTheme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className={`p-2 rounded-lg transition-colors ${currentTheme === 'dark' ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="flex-1">
            {isEditingTitle ? (
              <form onSubmit={handleTitleSubmit} className="flex-1">
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => setIsEditingTitle(false)}
                  onKeyDown={handleTitleKeyDown}
                  className={`text-xl font-semibold bg-transparent border-none outline-none w-full ${currentTheme === 'dark' ? 'text-white' : 'text-gray-900'}`}
                  placeholder={t('editor.untitled')}
                />
              </form>
            ) : (
              <h1
                onClick={handleTitleClick}
                className={`text-xl font-semibold cursor-pointer hover:opacity-75 transition-opacity ${currentTheme === 'dark' ? 'text-white' : 'text-gray-900'}`}
              >
                {title || t('editor.untitled')}
              </h1>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Connection status */}
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' : 
              connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
            }`}></div>
            <span className="text-sm">
              {connectionStatus === 'connected' ? t('status.online') : 
               connectionStatus === 'connecting' ? t('status.syncing') : t('status.offline')}
            </span>
            
            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              className={`p-1 rounded transition-colors ${
                currentTheme === 'dark' 
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' 
                  : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'
              }`}
              title={t('editor.save')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            
            {/* Manual save button */}
            <Button
              onClick={() => {
                console.log('🔧 Manual save triggered for content:', textContent);
                saveContent(textContent);
              }}
              disabled={isSaving || !hasUnsavedChanges}
              variant="ghost"
              size="sm"
              className={`p-1 ${
                hasUnsavedChanges && !isSaving
                  ? currentTheme === 'dark' 
                    ? 'hover:bg-green-700 text-green-400 hover:text-green-200' 
                    : 'hover:bg-green-200 text-green-600 hover:text-green-800'
                  : 'opacity-50 cursor-not-allowed text-gray-400'
              }`}
              title={hasUnsavedChanges ? t('editor.save') : t('editor.saved')}
            >
              💾
            </Button>
            
            {/* Live collaboration indicator */}
            {liveUpdateIndicator && (
              <div className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full animate-pulse ${
                currentTheme === 'dark' 
                  ? 'bg-blue-900 text-blue-300' 
                  : 'bg-blue-100 text-blue-600'
              }`}>
                <div className="w-1 h-1 bg-current rounded-full animate-ping"></div>
                <span>{t('editor.debugInfo.liveUpdate')}</span>
              </div>
            )}
          </div>

          {/* Save status */}
          {hasUnsavedChanges && (
            <div className="flex items-center space-x-1 text-xs text-orange-500">
              <div className="w-1 h-1 bg-orange-500 rounded-full"></div>
              <span>{t('editor.saving')}</span>
            </div>
          )}
          
          {lastSyncTime && !hasUnsavedChanges && (
            <div className="text-xs text-green-500">
              {t('editor.lastSaved', { time: lastSyncTime.toLocaleTimeString() })}
            </div>
          )}

          {/* Collaborative users */}
          {collaborativeUsers.length > 0 && (
            <div className="flex -space-x-2">
              {collaborativeUsers.slice(0, 5).map((user, index) => (
                <div
                  key={user.userId}
                  className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium text-white ${
                    user.isActive ? '' : 'opacity-50'
                  }`}
                  style={{ backgroundColor: user.color }}
                  title={`${user.displayName} ${user.isActive ? '(active)' : '(away)'}`}
                >
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
              ))}
              {collaborativeUsers.length > 5 && (
                <div className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium ${currentTheme === 'dark' ? 'bg-gray-600 text-white' : 'bg-gray-400 text-white'}`}>
                  +{collaborativeUsers.length - 5}
                </div>
              )}
            </div>
          )}

          {/* Comments toggle */}
          <button
            onClick={() => setShowComments(!showComments)}
            className={`p-2 rounded-lg transition-colors ${showComments ? 'bg-blue-500 text-white' : currentTheme === 'dark' ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
            title={t('editor.toggleComments')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>

          {/* Read-only indicator */}
          {readOnly && (
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${currentTheme === 'dark' ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
              {t('editor.readOnlyPlaceholder')}
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex">
        {/* Line authorship and locking sidebar */}
        <div className={`w-12 flex-shrink-0 ${
          currentTheme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        } border-r`}>
          <div className="py-6">
            {textContent.split('\n').map((line, index) => {
              const lineNumber = index + 1;
              const authorId = lineAuthors[lineNumber];
              const lockerId = lineLocks[lineNumber];
              const showAuthor = authorId && (index === 0 || authorId !== lineAuthors[index]);
              
              // Show lock indicator if line is locked
              if (lockerId) {
                const lockerInfo = getAuthorInfo(lockerId);
                return (
                  <div
                    key={`lock-${lineNumber}`}
                    className="flex justify-center mb-1"
                    style={{ height: '1.6rem' }}
                    title={t('editor.lineLocked', { user: lockerId })}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-red-400 animate-pulse"
                      style={{ backgroundColor: lockerInfo.color }}
                    >
                      🔒
                    </div>
                  </div>
                );
              }
              // Show author indicator if no lock and author should be shown
              else if (showAuthor) {
                const authorInfo = getAuthorInfo(authorId);
                return (
                  <div
                    key={`author-${lineNumber}`}
                    className="flex justify-center mb-1"
                    style={{ height: '1.6rem' }}
                    title={`Last edited by ${authorId}`}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: authorInfo.color }}
                    >
                      {authorInfo.initials}
                    </div>
                  </div>
                );
              } else {
                return (
                  <div
                    key={`spacer-${lineNumber}`}
                    style={{ height: '1.6rem' }}
                    className="mb-1"
                  />
                );
              }
            })}
          </div>
        </div>
        
        {/* Text editor */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={textContent}
            onChange={handleTextChange}
            disabled={readOnly}
            className={`enhanced-editor w-full h-full p-6 resize-none border-none outline-none text-base leading-relaxed ${
              currentTheme === 'dark' 
                ? 'bg-gray-900 text-gray-100 placeholder-gray-500 dark-mode' 
                : 'bg-white text-gray-900 placeholder-gray-400'
            } ${readOnly ? 'cursor-default' : ''}`}
            placeholder={readOnly ? t('editor.readOnlyPlaceholder') : t('editor.startTypingPlaceholder')}
            spellCheck={false}
            style={{ 
              lineHeight: '1.6',
              fontFamily: '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
              fontSize: '16px',
              letterSpacing: '0.01em',
              caretColor: '#60A5FA', // Light blue cursor
              fontWeight: '400',
              wordSpacing: '0.05em'
            }}
          />
          {/* Debug info */}
          {process.env.NODE_ENV === 'development' && (
            <div className="absolute bottom-2 right-2 text-xs opacity-50 bg-black text-white p-1 rounded">
              {t('editor.debugInfo.content')}: {textContent.length} {t('editor.debugInfo.chars')} | {isSaving ? t('editor.debugInfo.saving') : hasUnsavedChanges ? t('editor.debugInfo.unsaved') : t('editor.debugInfo.saved')} {liveUpdateIndicator ? t('editor.debugInfo.liveUpdate') : ''}
            </div>
          )}
        </div>

        {/* Comments sidebar */}
        {showComments && (
          <div className={`w-80 border-l ${currentTheme === 'dark' ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
            <div className="p-4">
              <h3 className="font-semibold mb-4">Comments</h3>
              <div className="space-y-4">
                {documentContent?.comments && documentContent.comments.length > 0 ? (
                  documentContent.comments.map((comment: DocumentComment) => (
                    <div key={comment.comment_id} className={`p-3 rounded-lg ${currentTheme === 'dark' ? 'bg-gray-700' : 'bg-white'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{comment.agent_id}</span>
                        <span className="text-xs opacity-75">
                          {new Date(comment.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm">{comment.comment_text}</p>
                      {comment.line_number !== undefined && (
                        <div className="text-xs opacity-75 mt-1">
                          Line {comment.line_number + 1}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm opacity-75">No comments yet</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
};

export default OpenAgentsDocumentEditor;
