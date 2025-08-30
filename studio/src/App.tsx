import React, { useState, useEffect, useCallback, useRef } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatView from './components/chat/ChatView';
import ThreadMessagingView, { ThreadState } from './components/chat/ThreadMessagingView';
import NetworkSelectionView from './components/network/NetworkSelectionView';
import AgentNamePicker from './components/network/AgentNamePicker';
import McpView from './components/mcp/McpView';
import { DocumentsView } from './components';
import useConversation from './hooks/useConversation';
import useTheme from './hooks/useTheme';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { NetworkProvider, useNetwork } from './context/NetworkContext';
import { NewsSummaryExample } from './components/mcp_output/template';
import { NetworkConnection } from './services/networkService';
import { OpenAgentsGRPCConnection } from './services/grpcService';
import { DocumentInfo } from './types';
import { clearAllOpenAgentsData } from './utils/cookies';

// App main component wrapped with NetworkProvider
const AppContent: React.FC = () => {
  const { currentNetwork, setCurrentNetwork, isConnected } = useNetwork();

  const [activeView, setActiveView] = useState<'chat' | 'settings' | 'profile' | 'mcp' | 'documents'>('chat');
  const [hasThreadMessaging, setHasThreadMessaging] = useState<boolean | null>(null);
  const [hasSharedDocuments, setHasSharedDocuments] = useState<boolean | null>(null);
  const [isCheckingMods, setIsCheckingMods] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkConnection | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [threadState, setThreadState] = useState<ThreadState | null>(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  
  // Documents state
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [documentsConnection, setDocumentsConnection] = useState<OpenAgentsGRPCConnection | null>(null);
  const threadMessagingRef = useRef<{ 
    getState: () => ThreadState;
    selectChannel: (channel: string) => void;
    selectDirectMessage: (agentId: string) => void;
  } | null>(null);
  
  // Debug thread state changes
  useEffect(() => {
    console.log('🔍 App Debug - threadState changed:', threadState);
    if (threadState) {
      console.log('🔍 App Debug - agents count:', threadState.agents?.length);
      console.log('🔍 App Debug - channels count:', threadState.channels?.length);
      threadState.agents?.forEach(agent => {
        console.log('🔍 App Debug - agent:', agent.agent_id, agent.metadata?.display_name);
      });
    } else {
      console.log('🔍 App Debug - threadState is null/undefined');
    }
  }, [threadState]);

  // Create a debug version of setThreadState
  const debugSetThreadState = useCallback((newState: ThreadState) => {
    console.log('🔍 App Debug - setThreadState called with:', newState);
    console.log('🔍 App Debug - new agents count:', newState.agents?.length);
    newState.agents?.forEach(agent => {
      console.log('🔍 App Debug - received agent:', agent.agent_id, agent.metadata?.display_name);
    });
    setThreadState(newState);
    // Force a re-render to update the MainLayout with new data
    setForceUpdate(prev => prev + 1);
  }, []);
  
  // Temporary override for testing - can be controlled via URL param or localStorage
  const forceThreadMessaging = new URLSearchParams(window.location.search).get('thread') === 'true' ||
                               localStorage.getItem('forceThreadMessaging') === 'true';
  
  const {
    activeConversationId,
    conversations,
    // updateConversationsFromMessages,
    handleConversationChange,
    createNewConversation,
    deleteConversation
  } = useConversation();

  const { theme, toggleTheme } = useTheme();

  // Add debug function to window for troubleshooting
  useEffect(() => {
    (window as any).clearOpenAgentsData = clearAllOpenAgentsData;
    console.log('🔧 Debug: Run clearOpenAgentsData() in console to clear all saved data');
  }, []);

  // Enhanced createNewConversation function that always shows chat view
  const createNewConversationAndShowChat = () => {
    createNewConversation();
    setActiveView('chat');
  };

  // Enhanced conversation change function that always shows chat view 
  const handleConversationChangeAndShowChat = (id: string) => {
    handleConversationChange(id);
    setActiveView('chat');
  };

  // Get current thread state from ref
  const getCurrentThreadState = useCallback((): ThreadState | null => {
    if (threadMessagingRef.current) {
      const state = threadMessagingRef.current.getState();
      console.log('🔍 App - getCurrentThreadState:', state.agents?.length, 'agents');
      return state;
    }
    return null;
  }, []);

  // Thread messaging handlers
  const handleChannelSelect = (channel: string) => {
    console.log('📂 Channel selected:', channel);
    if (threadMessagingRef.current) {
      threadMessagingRef.current.selectChannel(channel);
    }
  };

  const handleDirectMessageSelect = (agentId: string) => {
    console.log('💬 DM selected:', agentId);
    if (threadMessagingRef.current) {
      threadMessagingRef.current.selectDirectMessage(agentId);
    }
  };

  // Document selection handler
  const handleDocumentSelect = useCallback((documentId: string | null) => {
    console.log('📄 App - handleDocumentSelect called with:', documentId);
    setSelectedDocumentId(documentId);
    if (documentId) {
      setActiveView('documents'); // Switch to documents view when a document is selected
    }
  }, []);

  const handleNetworkSelected = (network: NetworkConnection) => {
    setSelectedNetwork(network);
    // Don't set as current network yet - wait for agent name selection
  };

  const handleAgentNameSelected = (name: string) => {
    setAgentName(name);
    setCurrentNetwork(selectedNetwork);
  };

  const handleBackToNetworkSelection = () => {
    setSelectedNetwork(null);
    setAgentName(null);
    setCurrentNetwork(null);
    // Reset mod detection state when switching networks
    setHasThreadMessaging(null);
    setHasSharedDocuments(null);
    setIsCheckingMods(false);
  };

  // Check for thread messaging mod when connected
  useEffect(() => {
    const checkThreadMessagingMod = async (): Promise<void> => {
      if (!currentNetwork || !isConnected || isCheckingMods) return;
      
      // Prevent repeated mod checks for the same network
      if (hasThreadMessaging !== null && hasSharedDocuments !== null) {
        console.log('Mods already detected, skipping re-check');
        return;
      }
      
      try {
        setIsCheckingMods(true);
        setHasThreadMessaging(null);
        setHasSharedDocuments(null);
        
        console.log(`🔍 Checking mods for network at ${currentNetwork.host}:${currentNetwork.port}`);
        
        // Use a consistent agent ID to avoid creating multiple connections
        const checkAgentId = `studio_mod_check_${currentNetwork.host}_${currentNetwork.port}`;
        const connection = new OpenAgentsGRPCConnection(checkAgentId, currentNetwork);
        
        const connected = await connection.connect();
        if (connected) {
          console.log('✅ Connected for mod detection');
          const hasThreadMod = await connection.hasThreadMessagingMod();
          const hasSharedDocMod = await connection.hasSharedDocumentMod();
          setHasThreadMessaging(hasThreadMod);
          setHasSharedDocuments(hasSharedDocMod);
          console.log(`📋 Thread messaging mod: ${hasThreadMod ? 'ENABLED' : 'disabled'}`);
          console.log(`📄 Shared document mod: ${hasSharedDocMod ? 'ENABLED' : 'disabled'}`);
          console.log('🎯 Interface mode:', hasThreadMod ? 'Thread Messaging' : 'Regular Chat');
          if (hasSharedDocMod) {
            console.log('📄 Documents tab will be available');
          }
          
          // Properly disconnect
          setTimeout(() => {
            try {
              connection.disconnect();
              console.log('🔌 Mod detection connection closed');
            } catch (e) {
              console.warn('⚠️ Error closing mod detection connection:', e);
            }
          }, 100);
        } else {
          console.log('❌ Failed to connect for mod detection, defaulting to regular chat');
          setHasThreadMessaging(false);
          setHasSharedDocuments(false);
        }
      } catch (error) {
        console.error('❌ Error checking for mods:', error);
        setHasThreadMessaging(false);
        setHasSharedDocuments(false);
      } finally {
        setIsCheckingMods(false);
      }
    };
    
    // Only check mods once when we have all required connection info
    if (isConnected && currentNetwork && agentName && !isCheckingMods) {
      checkThreadMessagingMod();
    }
  }, [currentNetwork, isConnected, agentName, hasThreadMessaging, hasSharedDocuments, isCheckingMods]);

  // Initialize documents connection when shared documents mod is available
  useEffect(() => {
    let isMounted = true;
    let currentConnection: OpenAgentsGRPCConnection | null = null;

    const initDocumentsConnection = async () => {
      if (!currentNetwork || !hasSharedDocuments || !agentName || !isMounted) return;

      try {
        // Use a consistent agent ID based on network to avoid multiple connections
        const agentId = `studio_documents_${currentNetwork.host}_${currentNetwork.port}`;
        const conn = new OpenAgentsGRPCConnection(agentId, currentNetwork);
        currentConnection = conn;
        
        const connected = await conn.connect();
        if (connected && isMounted) {
          setDocumentsConnection(conn);
          console.log('📄 Connected for documents management');
        }
      } catch (err) {
        console.error('Failed to initialize documents connection:', err);
      }
    };

    if (hasSharedDocuments) {
      initDocumentsConnection();
    }

    return () => {
      isMounted = false;
      if (currentConnection) {
        try {
          currentConnection.disconnect();
          console.log('📄 Documents connection cleaned up');
        } catch (e) {
          console.warn('⚠️ Error cleaning up documents connection:', e);
        }
      }
    };
  }, [currentNetwork, hasSharedDocuments, agentName]);

  // Load documents when connection is established
  const loadDocuments = useCallback(async () => {
    if (!documentsConnection) return;

    try {
      const docs = await documentsConnection.listDocuments(false); // Don't include closed documents by default
      console.log('📋 Loaded documents:', docs);
      setDocuments(docs || []);
    } catch (err) {
      console.error('Failed to load documents:', err);
    }
  }, [documentsConnection]);

  useEffect(() => {
    if (documentsConnection) {
      loadDocuments();
    }
  }, [documentsConnection, loadDocuments]);

  // Show network selection if no network is selected
  if (!selectedNetwork) {
    return <NetworkSelectionView onNetworkSelected={handleNetworkSelected} />;
  }

  // Show agent name picker if network is selected but no agent name
  if (selectedNetwork && !agentName) {
    return (
      <AgentNamePicker
        networkConnection={selectedNetwork}
        onAgentNameSelected={handleAgentNameSelected}
        onBack={handleBackToNetworkSelection}
        currentTheme={theme}
      />
    );
  }

  // Show loading if we have network and agent name but not yet connected
  if (!isConnected) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            Connecting as {agentName}...
          </p>
        </div>
      </div>
    );
  }

  // Show loading state while checking for mods
  if (isCheckingMods || hasThreadMessaging === null || hasSharedDocuments === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            Checking network capabilities...
          </p>
        </div>
      </div>
    );
  }

  // Show Thread Messaging interface if the mod is available OR force flag is set
  if (hasThreadMessaging || forceThreadMessaging) {
    if (forceThreadMessaging) {
      console.log('🚀 Forcing Thread Messaging interface for testing');
    }
    return (
      <ToastProvider>
        <ConfirmProvider>
          <MainLayout
            activeView={activeView}
            setActiveView={setActiveView}
            activeConversationId={activeConversationId}
            conversations={conversations}
            onConversationChange={handleConversationChangeAndShowChat}
            createNewConversation={createNewConversationAndShowChat}
            currentNetwork={currentNetwork}
            currentTheme={theme}
            toggleTheme={toggleTheme}
            hasSharedDocuments={hasSharedDocuments || false}
            hasThreadMessaging={hasThreadMessaging || false}
            agentName={agentName}
            threadState={getCurrentThreadState()}
            onChannelSelect={handleChannelSelect}
            onDirectMessageSelect={handleDirectMessageSelect}
            // Documents props
            documents={documents}
            onDocumentSelect={handleDocumentSelect}
            selectedDocumentId={selectedDocumentId}
          >
            {activeView === 'chat' ? (
              <ThreadMessagingView
                ref={threadMessagingRef}
                networkConnection={currentNetwork!}
                agentName={agentName!}
                currentTheme={theme}
                onProfileClick={() => setActiveView('profile')}
                toggleTheme={toggleTheme}
                hasSharedDocuments={hasSharedDocuments || false}
                onDocumentsClick={() => setActiveView('documents')}
                onThreadStateChange={debugSetThreadState}
              />
            ) : activeView === 'documents' ? (
              <DocumentsView 
                currentTheme={theme}
                onBackClick={() => setActiveView('chat')}
                documents={documents}
                selectedDocumentId={selectedDocumentId}
                onDocumentSelect={handleDocumentSelect}
                documentsConnection={documentsConnection}
                onDocumentsChange={setDocuments}
              />
            ) : activeView === 'settings' ? (
              <div className="p-6">
                <h1 className="text-2xl font-bold mb-4">Settings</h1>
                <p>Settings panel coming soon...</p>
              </div>
            ) : activeView === 'profile' ? (
              <div className="p-6">
                <h1 className="text-2xl font-bold mb-4">Profile</h1>
                <p>Profile panel coming soon...</p>
              </div>
            ) : activeView === 'mcp' ? (
              <McpView onBackClick={() => setActiveView('chat')} />
            ) : null}
          </MainLayout>
        </ConfirmProvider>
      </ToastProvider>
    );
  }

  // Fallback to regular chat interface if no thread messaging
  return (
    <ToastProvider>
      <ConfirmProvider>
        <MainLayout
          activeView={activeView}
          setActiveView={setActiveView}
          activeConversationId={activeConversationId}
          conversations={conversations}
          onConversationChange={handleConversationChangeAndShowChat}
          createNewConversation={createNewConversationAndShowChat}
          currentNetwork={currentNetwork}
          currentTheme={theme}
          toggleTheme={toggleTheme}
          hasSharedDocuments={hasSharedDocuments || false}
          hasThreadMessaging={hasThreadMessaging || false}
          agentName={agentName}
          threadState={getCurrentThreadState()}
          onChannelSelect={handleChannelSelect}
          onDirectMessageSelect={handleDirectMessageSelect}
          // Documents props
          documents={documents}
          onDocumentSelect={handleDocumentSelect}
          selectedDocumentId={selectedDocumentId}
        >
          {/* 新的布局：HTML结果在中间，聊天在右边 */}
          <div className="flex h-full">
            {/* 中间区域 - HTML结果 */}
            <div className="flex-1 p-6 overflow-auto bg-white dark:bg-gray-800">
              <div className="max-w-full">
                {activeView === 'profile' ? (
                  <NewsSummaryExample />
                ) : activeView === 'mcp' ? (
                  <McpView onBackClick={() => setActiveView('chat')} />
                ) : activeView === 'documents' && hasSharedDocuments ? (
                  <DocumentsView 
                    onBackClick={() => setActiveView('chat')}
                    currentTheme={theme}
                    documents={documents}
                    selectedDocumentId={selectedDocumentId}
                    onDocumentSelect={handleDocumentSelect}
                    documentsConnection={documentsConnection}
                    onDocumentsChange={setDocuments}
                  />
                ) : activeView === 'chat' ? (
                  <div>
                    <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
                      HTML 结果预览
                    </h2>
                    <NewsSummaryExample />
                  </div>
                ) : null}
              </div>
            </div>
            
            {/* 右边区域 - 聊天界面 */}
            <div className="w-96 border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              {activeView === 'chat' && (
                <div className="h-full flex flex-col">
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                      聊天助手
                    </h3>
                  </div>
                  <div className="flex-1 min-h-0">
                    <ChatView
                      conversationId={activeConversationId}
                      onDeleteConversation={() => {
                        deleteConversation(activeConversationId);
                        createNewConversation();
                      }}
                      currentTheme={theme}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </MainLayout>
      </ConfirmProvider>
    </ToastProvider>
  );
};

// Main App component with providers
const App: React.FC = () => {
  return (
    <NetworkProvider>
      <AppContent />
    </NetworkProvider>
  );
};

export default App; 