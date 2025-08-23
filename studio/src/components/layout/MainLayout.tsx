import React, { ReactNode, useEffect, useState } from 'react';
import Sidebar from '../Sidebar';
import ModSidebar from './ModSidebar';
import { NetworkConnection } from '../../services/networkService';

interface MainLayoutProps {
  children: ReactNode;
  activeView: 'chat' | 'settings' | 'profile' | 'mcp' | 'documents';
  setActiveView: (view: 'chat' | 'settings' | 'profile' | 'mcp' | 'documents') => void;
  activeConversationId: string;
  conversations: Array<{
    id: string;
    title: string;
    isActive: boolean;
  }>;
  onConversationChange: (id: string) => void;
  createNewConversation: () => void;
  currentNetwork: NetworkConnection | null;
  currentTheme: 'light' | 'dark';
  toggleTheme: () => void;
  hasSharedDocuments?: boolean;
  hasThreadMessaging?: boolean;
}

const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  activeView,
  setActiveView,
  activeConversationId,
  conversations,
  onConversationChange,
  createNewConversation,
  currentNetwork,
  currentTheme,
  toggleTheme,
  hasSharedDocuments = false,
  hasThreadMessaging = false
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);


  const toggleSidebar = (): void => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  useEffect(() => {
    console.log(`theme:${currentTheme} MainLayout`);
  }, [currentTheme]);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Left-most mod sidebar (Slack-style) */}
      <ModSidebar
        activeView={activeView}
        setActiveView={setActiveView}
        currentTheme={currentTheme}
        hasSharedDocuments={hasSharedDocuments}
        hasThreadMessaging={hasThreadMessaging}
      />

      {/* Main sidebar (only show for chat view) */}
      {activeView === 'chat' && hasThreadMessaging && (
        <Sidebar
          // isCollapsed={isSidebarCollapsed} 
          // toggleSidebar={toggleSidebar} 
          onSettingsClick={() => setActiveView('settings')}
          onProfileClick={() => setActiveView('profile')}
          onMcpClick={() => setActiveView('mcp')}
          onDocumentsClick={() => setActiveView('documents')}
          activeView={activeView}
          hasSharedDocuments={hasSharedDocuments}
          onConversationChange={onConversationChange}
          activeConversationId={activeConversationId}
          conversations={conversations}
          createNewConversation={createNewConversation}
          toggleTheme={toggleTheme}
          currentTheme={currentTheme}
          currentNetwork={currentNetwork}
        />
      )}

      <main className={`flex-1 flex flex-col overflow-hidden m-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 ${currentTheme === 'light' ? 'bg-gradient-to-br from-white via-blue-50 to-purple-50' : ''
        }`}>
        {children}
      </main>
    </div>
  );
};

export default MainLayout; 