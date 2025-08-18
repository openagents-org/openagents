import React, { useState, useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import ChatView from './components/chat/ChatView';
import NetworkSelectionView from './components/network/NetworkSelectionView';
import McpView from './components/mcp/McpView';
import useConversation from './hooks/useConversation';
import useTheme from './hooks/useTheme';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { NetworkProvider, useNetwork } from './context/NetworkContext';
import { NewsSummaryExample } from './components/mcp_output/template';
import { NetworkConnection } from './services/networkService';

// App main component wrapped with NetworkProvider
const AppContent: React.FC = () => {
  const { currentNetwork, setCurrentNetwork, isConnected } = useNetwork();

  const [activeView, setActiveView] = useState<'chat' | 'settings' | 'profile' | 'mcp'>('chat');
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
    setCurrentNetwork(network);
  };

  // Initialize MCP or network services when connected
  useEffect(() => {
    const initNetwork = async (): Promise<void> => {
      if (!currentNetwork) return;
      
      try {
        console.log(`Connected to OpenAgents network at ${currentNetwork.host}:${currentNetwork.port}`);
        // Here you would initialize any network-specific services
        // For now, we'll just log the connection
      } catch (error) {
        console.error('Error initializing network services:', error);
      }
    };
    
    if (isConnected && currentNetwork) {
      initNetwork();
    }
  }, [currentNetwork, isConnected]);

  // Show network selection if not connected
  if (!isConnected) {
    return <NetworkSelectionView onNetworkSelected={handleNetworkSelected} />;
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