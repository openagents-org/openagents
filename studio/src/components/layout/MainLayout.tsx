import React, { ReactNode, useEffect, useState } from 'react';
import Sidebar from '../Sidebar';
import { NetworkConnection } from '../../services/networkService';

interface MainLayoutProps {
  children: ReactNode;
  activeView: 'chat' | 'settings' | 'profile' | 'mcp';
  setActiveView: (view: 'chat' | 'settings' | 'profile' | 'mcp') => void;
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
  toggleTheme
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
      <Sidebar
        // isCollapsed={isSidebarCollapsed} 
        // toggleSidebar={toggleSidebar} 
        onSettingsClick={() => setActiveView('settings')}
        onProfileClick={() => setActiveView('profile')}
        onMcpClick={() => setActiveView('mcp')}
        activeView={activeView}
        onConversationChange={onConversationChange}
        activeConversationId={activeConversationId}
        conversations={conversations}
        createNewConversation={createNewConversation}
        toggleTheme={toggleTheme}
        currentTheme={currentTheme}
        currentNetwork={currentNetwork}
      />

      <main className={`flex-1 flex flex-col overflow-hidden m-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 ${currentTheme === 'light' ? 'bg-gradient-to-br from-white via-blue-50 to-purple-50' : ''
        }`}>
        {children}
      </main>
    </div>
  );
};

export default MainLayout; 