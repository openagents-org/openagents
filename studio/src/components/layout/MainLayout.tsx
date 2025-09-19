import React, { ReactNode, useEffect } from "react";
import Sidebar from "../Sidebar";
import ModSidebar from "./ModSidebar";
import { DocumentInfo } from "@/types";
import { useThemeStore } from "@/stores/themeStore";

// Legacy ThreadState type - TODO: Remove when MainLayout is deprecated
interface ThreadState {
  channels?: any[];
  agents?: any[];
  currentChannel?: string | null;
  currentDirectMessage?: string | null;
}

interface MainLayoutProps {
  children: ReactNode;
  activeConversationId: string;
  conversations: Array<{
    id: string;
    title: string;
    isActive: boolean;
  }>;
  onConversationChange: (id: string) => void;
  createNewConversation: () => void;
  hasSharedDocuments?: boolean;
  hasThreadMessaging?: boolean;
  threadState?: ThreadState | null;
  onChannelSelect?: (channel: string) => void;
  onDirectMessageSelect?: (agentId: string) => void;
  // Documents props
  documents?: DocumentInfo[];
  onDocumentSelect?: (documentId: string | null) => void;
  selectedDocumentId?: string | null;
}

const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  activeConversationId,
  conversations,
  onConversationChange,
  createNewConversation,
  hasSharedDocuments = false,
  hasThreadMessaging = false,
  threadState = null,
  onChannelSelect,
  onDirectMessageSelect,
  // Documents props
  documents = [],
  onDocumentSelect,
  selectedDocumentId = null,
}) => {
  const { theme: currentTheme, toggleTheme } = useThemeStore();
  // Use passed thread state instead of hook

  useEffect(() => {
    console.log(`theme:${currentTheme} MainLayout`);
  }, [currentTheme]);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Left-most mod sidebar (Slack-style) */}
      <ModSidebar
        hasSharedDocuments={hasSharedDocuments}
        hasThreadMessaging={hasThreadMessaging}
      />

      {/* Main sidebar - always show, with thread messaging data when available */}
      <Sidebar
        hasSharedDocuments={hasSharedDocuments}
        onConversationChange={onConversationChange}
        activeConversationId={activeConversationId}
        conversations={conversations}
        createNewConversation={createNewConversation}
        toggleTheme={toggleTheme}
        currentTheme={currentTheme}
        // Thread messaging props
        showThreadMessaging={hasThreadMessaging}
        channels={threadState?.channels || []}
        agents={threadState?.agents || []}
        currentChannel={threadState?.currentChannel || null}
        currentDirectMessage={threadState?.currentDirectMessage || null}
        unreadCounts={{}} // TODO: implement unread counts
        onChannelSelect={onChannelSelect}
        onDirectMessageSelect={onDirectMessageSelect}
        // Documents props
        documents={documents}
        onDocumentSelect={onDocumentSelect}
        selectedDocumentId={selectedDocumentId}
      />

      <main
        className={`flex-1 flex flex-col overflow-hidden m-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 ${
          currentTheme === "light"
            ? "bg-gradient-to-br from-white via-blue-50 to-purple-50"
            : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
