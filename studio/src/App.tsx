import React, { useState, useEffect, useCallback, useRef } from "react";
import MainLayout from "./components/layout/MainLayout";
import ChatView from "./components/chat/ChatView";
import NetworkSelectionView from "./components/network/NetworkSelectionView";
import AgentNamePicker from "./components/network/AgentNamePicker";
import McpView from "./components/mcp/McpView";
import { DocumentsView } from "./components";
import useConversation from "./hooks/useConversation";
import { ToastProvider } from "./context/ToastContext";
import { ConfirmProvider } from "./context/ConfirmContext";
import { useThemeStore } from "@/stores/themeStore";
import { DocumentInfo } from "./types";

// Updated Thread Messaging with new event system
import { ThreadChannel, AgentInfo } from "./types/events";
import ThreadMessagingViewEventBased from "./components/chat/ThreadMessagingViewEventBased";

import ConnectionLoadingPage from "@/pages/connection/ConnectionLoadingPage";
import { useNetworkStore } from "@/stores/networkStore";
import { clearAllOpenAgentsData } from "@/utils/cookies";
import useConnectedStatus from "@/hooks/useConnectedStatus";
import { PLUGIN_NAME_ENUM } from "@/types/plugins";
import { useViewStore } from "@/stores/viewStore";

// Thread state for compatibility with existing UI
export interface ThreadState {
  channels?: ThreadChannel[];
  agents?: AgentInfo[];
  currentChannel?: string | null;
  currentDirectMessage?: string | null;
}

// App main component
const AppContent: React.FC = () => {
  const { selectedNetwork, agentName, clearAgentName, clearNetwork } =
    useNetworkStore();
  const { isConnected, channels, connectionStatus, openAgentsHook } =
    useConnectedStatus();

  const { activeView, setActiveView } = useViewStore();

  const [threadState, setThreadState] = useState<ThreadState | null>(null);

  // Determine if we have thread messaging (always true with new system)
  const hasThreadMessaging = true;
  const hasSharedDocuments = true; // Assume documents are available

  // Handle thread state changes
  const handleThreadStateChange = useCallback((newState: ThreadState) => {
    setThreadState(newState);
  }, []);

  const {
    activeConversationId,
    conversations,
    handleConversationChange,
    createNewConversation,
    deleteConversation,
  } = useConversation();

  // Add debug function to window for troubleshooting
  useEffect(() => {
    clearNetwork();
    clearAgentName();

    (window as any).clearOpenAgentsData = clearAllOpenAgentsData;
    console.log(
      "🔧 Debug: Run clearOpenAgentsData() in console to clear all saved data"
    );
  }, [clearNetwork, clearAgentName]);

  // Enhanced createNewConversation function that always shows chat view
  const createNewConversationAndShowChat = useCallback(() => {
    createNewConversation();
    setActiveView(PLUGIN_NAME_ENUM.CHAT);
  }, [createNewConversation, setActiveView]);

  // Enhanced conversation change function that always shows chat view
  const handleConversationChangeAndShowChat = useCallback(
    (id: string) => {
      handleConversationChange(id);
      setActiveView(PLUGIN_NAME_ENUM.CHAT);
    },
    [handleConversationChange, setActiveView]
  );

  const threadMessagingRef = useRef<{
    getState: () => ThreadState;
    selectChannel: (channel: string) => void;
    selectDirectMessage: (agentId: string) => void;
  } | null>(null);

  // Get current thread state from ref or fallback to basic state
  const getCurrentThreadState = useCallback((): ThreadState | null => {
    if (threadMessagingRef.current) {
      return threadMessagingRef.current.getState();
    }
    return {
      channels: channels || [],
      agents: [],
      currentChannel: null,
      currentDirectMessage: null,
    };
  }, [channels]);

  // Thread messaging handlers
  const handleChannelSelect = useCallback((channel: string) => {
    threadMessagingRef.current?.selectChannel(channel);
  }, []);

  const handleDirectMessageSelect = useCallback((agentId: string) => {
    threadMessagingRef.current?.selectDirectMessage(agentId);
  }, []);

  // Documents state
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );

  // Document selection handler
  const handleDocumentSelect = useCallback(
    (documentId: string | null) => {
      setSelectedDocumentId(documentId);
      if (documentId) {
        setActiveView(PLUGIN_NAME_ENUM.DOCUMENTS);
      }
    },
    [setActiveView]
  );

  // Step One Page - Show network selection if no network is selected
  if (!selectedNetwork) {
    return <NetworkSelectionView />;
  }

  // Step Two Page - Show agent name picker if network is selected but no agent name
  if (selectedNetwork && !agentName) {
    return <AgentNamePicker />;
  }

  // Step Three Page - Show loading if we have network and agent name but not yet connected
  if (!isConnected) {
    return <ConnectionLoadingPage connectionStatus={connectionStatus} />;
  }

  // Show the original UI with thread messaging
  return (
    <ToastProvider>
      <ConfirmProvider>
        <MainLayout
          activeConversationId={activeConversationId}
          conversations={conversations}
          onConversationChange={handleConversationChangeAndShowChat}
          createNewConversation={createNewConversationAndShowChat}
          hasSharedDocuments={hasSharedDocuments}
          hasThreadMessaging={hasThreadMessaging}
          threadState={getCurrentThreadState()}
          onChannelSelect={handleChannelSelect}
          onDirectMessageSelect={handleDirectMessageSelect}
          // Documents props
          documents={documents}
          onDocumentSelect={handleDocumentSelect}
          selectedDocumentId={selectedDocumentId}
        >
          {activeView === PLUGIN_NAME_ENUM.CHAT ? (
            hasThreadMessaging ? (
              // Use the new thread messaging with event system
              <ThreadMessagingViewEventBased
                ref={threadMessagingRef}
                openAgentsHook={openAgentsHook}
                agentName={agentName!}
                onProfileClick={() => setActiveView(PLUGIN_NAME_ENUM.PROFILE)}
                hasSharedDocuments={hasSharedDocuments}
                onDocumentsClick={() =>
                  setActiveView(PLUGIN_NAME_ENUM.DOCUMENTS)
                }
                onThreadStateChange={handleThreadStateChange}
              />
            ) : (
              // Fallback to regular chat
              <ChatView
                conversationId={activeConversationId}
                onDeleteConversation={() => {
                  deleteConversation(activeConversationId);
                  createNewConversation();
                }}
              />
            )
          ) : activeView === "documents" ? (
            <DocumentsView
              onBackClick={() => setActiveView(PLUGIN_NAME_ENUM.CHAT)}
              documents={documents}
              selectedDocumentId={selectedDocumentId}
              onDocumentSelect={handleDocumentSelect}
              onDocumentsChange={setDocuments}
            />
          ) : activeView === "settings" ? (
            <div className="p-6">
              <h1 className="text-2xl font-bold mb-4">Settings</h1>
              <p>Settings panel coming soon...</p>
            </div>
          ) : activeView === "profile" ? (
            <div className="p-6">
              <h1 className="text-2xl font-bold mb-4">Profile</h1>
              <p>Profile panel coming soon...</p>
            </div>
          ) : activeView === "mcp" ? (
            <McpView onBackClick={() => setActiveView(PLUGIN_NAME_ENUM.CHAT)} />
          ) : null}
        </MainLayout>
      </ConfirmProvider>
    </ToastProvider>
  );
};

// Main App component
const App: React.FC = () => {
  return <AppContent />;
};

export default App;
