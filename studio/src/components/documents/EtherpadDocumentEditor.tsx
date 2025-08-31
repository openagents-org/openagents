import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DocumentContent, DocumentComment, AgentPresence } from '../../types';
import { OpenAgentsGRPCConnection } from '../../services/grpcService';

interface EtherpadDocumentEditorProps {
  documentId: string;
  connection: OpenAgentsGRPCConnection;
  currentTheme: 'light' | 'dark';
  onBack: () => void;
  readOnly?: boolean;
}

interface EtherpadConfig {
  baseUrl: string;
  apiKey?: string;
  padName: string;
}

const EtherpadDocumentEditor: React.FC<EtherpadDocumentEditorProps> = ({
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
  const [title, setTitle] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [collaborativeUsers, setCollaborativeUsers] = useState<any[]>([]);
  const [tempEtherpadUrl, setTempEtherpadUrl] = useState('');
  
  // Etherpad configuration - use public demo instance by default
  const [etherpadConfig, setEtherpadConfig] = useState<EtherpadConfig>(() => {
    // Clean the document ID to make it Etherpad-compatible
    // Remove hyphens, special characters, and make it alphanumeric only
    const cleanDocId = documentId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    return {
      baseUrl: process.env.REACT_APP_ETHERPAD_URL || 'https://pad.riseup.net',
      padName: `openagents${cleanDocId}`
    };
  });
  
  // Refs
  const titleRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync interval (ms) - how often to sync with OpenAgents backend
  const SYNC_INTERVAL = 5000;

  // Handle document content received via events
  const handleDocumentContentReceived = useCallback((content: any) => {
    console.log('📄 Document content received via event:', content);
    setDocumentContent(content);
    setTitle(content.document_id || documentId);
    
    // Initialize Etherpad with the content
    if (content.content && content.content.length > 0) {
      const textContent = content.content.join('\n');
      initializeEtherpadContent(textContent);
    }
    
    // Initialize collaborative users from agent presence
    if (content.agent_presence) {
      setCollaborativeUsers(content.agent_presence);
    }
    
    setIsLoading(false);
  }, [documentId]);

  // Initialize Etherpad content
  const initializeEtherpadContent = useCallback(async (content: string) => {
    // If we have Etherpad API access, we can set the initial content
    // For now, we'll rely on the iframe and manual sync
    console.log('📝 Initializing Etherpad with content:', content);
  }, []);

  // Sync Etherpad content back to OpenAgents
  const syncToOpenAgents = useCallback(async () => {
    try {
      // Get content from Etherpad iframe (this would require postMessage communication)
      // For now, we'll implement a basic sync mechanism
      console.log('🔄 Syncing Etherpad content to OpenAgents...');
      
      // This is a placeholder - in a real implementation, you'd:
      // 1. Get content from Etherpad via postMessage or API
      // 2. Compare with last known state
      // 3. Send changes to OpenAgents backend via connection.replaceLines()
      
    } catch (error) {
      console.error('Failed to sync content:', error);
    }
  }, [connection, documentId]);

  // Load document content
  const loadDocumentContent = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('📖 Loading document:', documentId);
      
      // Request document content - this will trigger 'document_content' events
      const result = await connection.getDocumentContent(documentId, true, true);
      console.log('📤 Document content requested:', result);
      
    } catch (err) {
      console.error('Failed to load document content:', err);
      setError('Failed to load document content');
      setIsLoading(false);
    }
  }, [connection, documentId]);

  // Set up event listeners
  useEffect(() => {
    if (connection) {
      // Listen for document content events
      connection.on('document_content', handleDocumentContentReceived);
      
      // Cleanup event listeners
      return () => {
        connection.off('document_content', handleDocumentContentReceived);
      };
    }
  }, [connection, handleDocumentContentReceived]);

  // Load document when component mounts
  useEffect(() => {
    loadDocumentContent();
  }, [loadDocumentContent]);

  // Set up periodic sync with OpenAgents backend
  useEffect(() => {
    if (!readOnly && documentContent) {
      const syncInterval = setInterval(syncToOpenAgents, SYNC_INTERVAL);
      return () => clearInterval(syncInterval);
    }
  }, [syncToOpenAgents, readOnly, documentContent]);

  // Handle title editing
  const handleTitleClick = () => {
    if (!readOnly) {
      setIsEditingTitle(true);
      setTimeout(() => titleRef.current?.focus(), 0);
    }
  };

  const handleTitleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditingTitle(false);
    // TODO: Implement title update via OpenAgents API
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setTitle(documentContent?.document_id || documentId);
    }
  };

  // Handle Etherpad URL change
  const handleEtherpadUrlChange = () => {
    if (tempEtherpadUrl.trim()) {
      setEtherpadConfig(prev => ({
        ...prev,
        baseUrl: tempEtherpadUrl.trim()
      }));
      setShowSettings(false);
      setTempEtherpadUrl('');
    }
  };

  // Initialize temp URL when settings open
  const handleSettingsOpen = () => {
    setTempEtherpadUrl(etherpadConfig.baseUrl);
    setShowSettings(true);
  };

  // Construct Etherpad URL with clean parameters
  const etherpadUrl = `${etherpadConfig.baseUrl}/p/${etherpadConfig.padName}?showControls=true&showChat=false&showLineNumbers=false&useMonospaceFont=false&noColors=false&userName=OpenAgentsUser`;

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
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={loadDocumentContent}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col ${currentTheme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      {/* Header */}
      <div className={`border-b px-6 py-4 flex items-center justify-between ${currentTheme === 'dark' ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
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
                  placeholder="Document title"
                />
              </form>
            ) : (
              <h1
                onClick={handleTitleClick}
                className={`text-xl font-semibold cursor-pointer hover:opacity-75 transition-opacity ${currentTheme === 'dark' ? 'text-white' : 'text-gray-900'}`}
              >
                {title || 'Untitled Document'}
              </h1>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Collaborative users */}
          {collaborativeUsers.length > 0 && (
            <div className="flex -space-x-2">
              {collaborativeUsers.slice(0, 5).map((user, index) => (
                <div
                  key={user.agent_id}
                  className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium text-white`}
                  style={{ backgroundColor: `hsl(${index * 137.5}, 70%, 50%)` }}
                  title={user.agent_id}
                >
                  {user.agent_id.charAt(0).toUpperCase()}
                </div>
              ))}
              {collaborativeUsers.length > 5 && (
                <div className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium ${currentTheme === 'dark' ? 'bg-gray-600 text-white' : 'bg-gray-400 text-white'}`}>
                  +{collaborativeUsers.length - 5}
                </div>
              )}
            </div>
          )}

          {/* Settings toggle */}
          <button
            onClick={handleSettingsOpen}
            className={`p-2 rounded-lg transition-colors ${currentTheme === 'dark' ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
            title="Etherpad settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Comments toggle */}
          <button
            onClick={() => setShowComments(!showComments)}
            className={`p-2 rounded-lg transition-colors ${showComments ? 'bg-blue-500 text-white' : currentTheme === 'dark' ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
            title="Toggle comments"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>

          {/* Read-only indicator */}
          {readOnly && (
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${currentTheme === 'dark' ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
              Read Only
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex">
        {/* Etherpad iframe */}
        <div className="flex-1 relative">
          <iframe
            ref={iframeRef}
            src={etherpadUrl}
            className="w-full h-full border-none"
            title={`Etherpad - ${title}`}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
          
          {/* Overlay for read-only mode */}
          {readOnly && (
            <div className="absolute inset-0 bg-black bg-opacity-10 flex items-center justify-center pointer-events-none">
              <div className={`px-4 py-2 rounded-lg ${currentTheme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} shadow-lg`}>
                <svg className="w-6 h-6 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Read Only Mode
              </div>
            </div>
          )}
        </div>

        {/* Comments sidebar */}
        {showComments && (
          <div className={`w-80 border-l ${currentTheme === 'dark' ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
            <div className="p-4">
              <h3 className="text-lg font-semibold mb-4">Comments</h3>
              <div className="space-y-4">
                {/* Comments will be populated here */}
                <div className={`text-center py-8 ${currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p>No comments yet</p>
                  <p className="text-sm mt-1">Select text to add a comment</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className={`border-t px-6 py-2 flex items-center justify-between text-sm ${currentTheme === 'dark' ? 'border-gray-700 bg-gray-800 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
        <div className="flex items-center space-x-4">
          <span>Document ID: {documentId}</span>
          {collaborativeUsers.length > 0 && (
            <span>{collaborativeUsers.length} active user{collaborativeUsers.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span>Connected to Etherpad</span>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`max-w-md w-full mx-4 rounded-lg shadow-xl ${currentTheme === 'dark' ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Etherpad Settings</h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className={`p-1 rounded-lg transition-colors ${currentTheme === 'dark' ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-600'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Etherpad Server URL
                  </label>
                  <input
                    type="url"
                    value={tempEtherpadUrl}
                    onChange={(e) => setTempEtherpadUrl(e.target.value)}
                    placeholder="https://your-etherpad-server.com"
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      currentTheme === 'dark' 
                        ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    }`}
                  />
                  <p className="text-xs mt-1 opacity-75">
                    Current: {etherpadConfig.baseUrl}
                  </p>
                </div>

                <div className={`p-3 rounded-lg ${currentTheme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  <h4 className="text-sm font-medium mb-2">Popular Public Instances:</h4>
                  <div className="space-y-1 text-xs">
                    <button
                      onClick={() => setTempEtherpadUrl('https://pad.riseup.net')}
                      className="block w-full text-left px-2 py-1 rounded hover:bg-blue-500 hover:text-white transition-colors"
                    >
                      pad.riseup.net (Default)
                    </button>
                    <button
                      onClick={() => setTempEtherpadUrl('https://etherpad.wikimedia.org')}
                      className="block w-full text-left px-2 py-1 rounded hover:bg-blue-500 hover:text-white transition-colors"
                    >
                      etherpad.wikimedia.org
                    </button>
                    <button
                      onClick={() => setTempEtherpadUrl('https://board.net')}
                      className="block w-full text-left px-2 py-1 rounded hover:bg-blue-500 hover:text-white transition-colors"
                    >
                      board.net
                    </button>
                    <button
                      onClick={() => setTempEtherpadUrl('https://pad.fnordig.de')}
                      className="block w-full text-left px-2 py-1 rounded hover:bg-blue-500 hover:text-white transition-colors"
                    >
                      pad.fnordig.de
                    </button>
                    <button
                      onClick={() => setTempEtherpadUrl('https://yopad.eu')}
                      className="block w-full text-left px-2 py-1 rounded hover:bg-blue-500 hover:text-white transition-colors"
                    >
                      yopad.eu
                    </button>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowSettings(false)}
                    className={`flex-1 px-4 py-2 rounded-lg transition-colors ${
                      currentTheme === 'dark' 
                        ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' 
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEtherpadUrlChange}
                    disabled={!tempEtherpadUrl.trim()}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EtherpadDocumentEditor;
