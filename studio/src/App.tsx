import React, { useState, useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatView from './components/chat/ChatView';
import ThreadMessagingView from './components/chat/ThreadMessagingView';
import NetworkSelectionView from './components/network/NetworkSelectionView';
import AgentNamePicker from './components/network/AgentNamePicker';
import McpView from './components/mcp/McpView';
import useConversation from './hooks/useConversation';
import useTheme from './hooks/useTheme';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { NetworkProvider, useNetwork } from './context/NetworkContext';
import { NewsSummaryExample } from './components/mcp_output/template';
import { NetworkConnection } from './services/networkService';
import { OpenAgentsConnection } from './services/openagentsService';

// App main component wrapped with NetworkProvider
const AppContent: React.FC = () => {
  const { currentNetwork, setCurrentNetwork, isConnected } = useNetwork();

  const [activeView, setActiveView] = useState<'chat' | 'settings' | 'profile' | 'mcp'>('chat');
  const [hasThreadMessaging, setHasThreadMessaging] = useState<boolean | null>(null);
  const [isCheckingMods, setIsCheckingMods] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkConnection | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  
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
  };

  // Check for thread messaging mod when connected
  useEffect(() => {
    const checkThreadMessagingMod = async (): Promise<void> => {
      if (!currentNetwork || !isConnected) return;
      
      try {
        setIsCheckingMods(true);
        setHasThreadMessaging(null);
        
        console.log(`Connected to OpenAgents network at ${currentNetwork.host}:${currentNetwork.port}`);
        
        // Try to connect and check for thread messaging mod
        const checkAgentId = agentName || `studio_check_${Date.now()}`;
        const connection = new OpenAgentsConnection(checkAgentId, currentNetwork);
        
        const connected = await connection.connect();
        if (connected) {
          console.log('Successfully connected for mod detection');
          const hasThreadMod = await connection.hasThreadMessagingMod();
          setHasThreadMessaging(hasThreadMod);
          console.log(`Thread messaging mod ${hasThreadMod ? 'detected' : 'not found'} on network`);
          console.log('Will show', hasThreadMod ? 'Thread Messaging interface' : 'regular chat interface');
          connection.disconnect();
        } else {
          console.log('Failed to connect for mod detection, defaulting to regular chat');
          setHasThreadMessaging(false);
        }
      } catch (error) {
        console.error('Error checking for thread messaging mod:', error);
        setHasThreadMessaging(false);
      } finally {
        setIsCheckingMods(false);
      }
    };
    
    if (isConnected && currentNetwork && agentName) {
      checkThreadMessagingMod();
    }
  }, [currentNetwork, isConnected, agentName]);

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
  if (isCheckingMods || hasThreadMessaging === null) {
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
          <ThreadMessagingView
            networkConnection={currentNetwork!}
            agentName={agentName!}
            currentTheme={theme}
          />
        </ConfirmProvider>
      </ToastProvider>
    );
  }

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