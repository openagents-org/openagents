import React from "react";
import { useTranslation } from "react-i18next";
import { ThreadChannel, AgentInfo } from "@/types/events";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useChatStore, setChatStoreContext } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";

// Section Header Component
const SectionHeader: React.FC<{ title: string }> = React.memo(({ title }) => (
  <div className="px-5 my-3">
    <div className="flex items-center">
      <div className="text-xs font-bold text-gray-400 tracking-wide select-none">
        {title}
      </div>
      <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
    </div>
  </div>
));
SectionHeader.displayName = "SectionHeader";

// Channel List Item Component
const ChannelItem: React.FC<{
  channel: ThreadChannel;
  isActive: boolean;
  unreadCount: number;
  onClick: () => void;
}> = React.memo(({ channel, isActive, unreadCount, onClick }) => (
  <li>
    <button
      onClick={onClick}
      className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
        ${isActive
          ? "bg-[#F4F4F5] text-gray-900 dark:bg-[#F4F4F5] dark:text-gray-900 pl-2"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-900 pl-2.5"
        }
      `}
      title={channel.description || channel.name}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <span className="mr-2 text-gray-400">#</span>
          <span className="truncate">{channel.name}</span>
        </div>
        {unreadCount > 0 && (
          <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>
    </button>
  </li>
));
ChannelItem.displayName = "ChannelItem";

// Agent List Item Component
const AgentItem: React.FC<{
  agent: AgentInfo;
  isActive: boolean;
  unreadCount: number;
  onClick: () => void;
}> = React.memo(({ agent, isActive, unreadCount, onClick }) => (
  <li>
    <button
      onClick={onClick}
      className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
        ${isActive
          ? "bg-[#F4F4F5] text-gray-900 dark:bg-[#F4F4F5] dark:text-gray-900 pl-2"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-900 pl-2.5"
        }
      `}
      title={agent.metadata?.display_name || agent.agent_id}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <div
            className={`w-2 h-2 rounded-full mr-2 ${agent.metadata?.status === "online"
              ? "bg-green-500"
              : "bg-gray-400"
              }`}
          />
          <span className="truncate">
            {agent.metadata?.display_name || agent.agent_id}
          </span>
        </div>
        {unreadCount > 0 && (
          <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>
    </button>
  </li>
));
AgentItem.displayName = "AgentItem";

// Chat Sidebar Content Component - Use chatStore to get data
const MessagingSidebar: React.FC = () => {
  const { t } = useTranslation('messaging');
  const { connector, connectionStatus, isConnected } = useOpenAgents();
  const { agentName } = useAuthStore();

  // Set chatStore context reference
  React.useEffect(() => {
    setChatStoreContext({ connector, connectionStatus, isConnected });
  }, [connector, connectionStatus, isConnected]);

  // Use agentName as fallback if connectionStatus.agentId is unavailable
  const currentUserId = ('agentId' in connectionStatus ? connectionStatus.agentId : undefined) || agentName || undefined;

  // Use chatStore to get data and selection state
  const {
    currentChannel,
    currentDirectMessage,
    selectChannel,
    selectDirectMessage,
    channels,
    channelsLoading,
    channelsLoaded,
    agents,
    agentsLoading,
    agentsLoaded,
    loadChannels,
    loadAgents,
    restorePersistedSelection,
    initializeWithDefaultSelection,
  } = useChatStore();

  // Load initial data - only call when not loaded
  React.useEffect(() => {
    if (isConnected) {
      if (!channelsLoaded && !channelsLoading) {
        console.log('MessagingSidebar: Loading channels...');
        loadChannels();
      }
      if (!agentsLoaded && !agentsLoading) {
        console.log('MessagingSidebar: Loading agents...');
        loadAgents();
      }
    }
  }, [isConnected, channelsLoaded, channelsLoading, agentsLoaded, agentsLoading, loadChannels, loadAgents]);

  // Handle selection restoration and default selection - execute after data loading completes
  React.useEffect(() => {
    const handleSelectionInitialization = async () => {
      // Check if there is already a selection (may be restored from persistence)
      if (currentChannel || currentDirectMessage) {
        console.log('MessagingSidebar: Already has selection, skipping initialization');
        return;
      }

      // Only execute initialization when both are loaded
      if (!channelsLoaded || !agentsLoaded) {
        console.log('MessagingSidebar: Waiting for data to load before selection initialization');
        return;
      }

      console.log('MessagingSidebar: Data loaded, attempting selection restoration/initialization');

      try {
        // Try to restore persisted selection
        await restorePersistedSelection();

        // If still no selection after restoration, use default selection
        // Need to check again, because restorePersistedSelection may set selection
        const state = useChatStore.getState();
        if (!state.currentChannel && !state.currentDirectMessage) {
          console.log('MessagingSidebar: No persisted selection restored, using default selection');
          await initializeWithDefaultSelection();
        }
      } catch (error) {
        console.error('MessagingSidebar: Error during selection initialization:', error);
        // If error occurs, use default selection
        await initializeWithDefaultSelection();
      }
    };

    handleSelectionInitialization();
  }, [channelsLoaded, agentsLoaded, currentChannel, currentDirectMessage, restorePersistedSelection, initializeWithDefaultSelection]);

  // Filter out current user
  const filteredAgents = React.useMemo(() => {
    return agents.filter(agent => agent.agent_id !== currentUserId);
  }, [agents, currentUserId]);

  // Debug information
  console.log("MessagingSidebar Debug:", {
    connectionStatus: 'state' in connectionStatus ? connectionStatus.state : connectionStatus,
    connectionAgentId: 'agentId' in connectionStatus ? connectionStatus.agentId : undefined,
    networkAgentName: agentName,
    currentUserId,
    isConnected,
    channelsCount: channels.length,
    agentsCount: filteredAgents.length,
    isChannelLoading: channelsLoading,
    isDirectLoading: agentsLoading,
    channelsLoaded,
    agentsLoaded,
    currentChannel,
    currentDirectMessage,
  });

  // TODO: Implement unreadCounts logic
  const unreadCounts: Record<string, number> = {};

  // Channel selection handling - now using chatStore
  const onChannelSelect = (channel: string) => {
    selectChannel(channel);
  };

  // DM selection handling - now using chatStore
  const onDirectMessageSelect = (agentId: string) => {
    selectDirectMessage(agentId);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Channels Section */}
      <SectionHeader title={t('sidebar.channels')} />
      <div className="px-3">
        {channelsLoading && channels.length === 0 ? (
          <div className="text-gray-500 text-sm px-2 py-2 text-center">
            {t('sidebar.loadingChannels')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {channels.map((channel) => (
              <ChannelItem
                key={channel.name}
                channel={channel}
                isActive={currentChannel === channel.name}
                unreadCount={unreadCounts[channel.name] || 0}
                onClick={() => onChannelSelect(channel.name)}
              />
            ))}
            {channels.length === 0 && !channelsLoading && (
              <div className="text-gray-500 text-sm px-2 py-2 text-center">
                {t('sidebar.noChannels')}
              </div>
            )}
          </ul>
        )}
      </div>

      {/* Direct Messages Section */}
      <SectionHeader title={t('sidebar.directMessages')} />
      <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
        {agentsLoading && filteredAgents.length === 0 ? (
          <div className="text-gray-500 text-sm px-2 py-2 text-center">
            {t('sidebar.loadingAgents')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {filteredAgents.map((agent) => (
              <AgentItem
                key={agent.agent_id}
                agent={agent}
                isActive={currentDirectMessage === agent.agent_id}
                unreadCount={unreadCounts[agent.agent_id] || 0}
                onClick={() => onDirectMessageSelect(agent.agent_id)}
              />
            ))}
            {filteredAgents.length === 0 && !agentsLoading && (
              <div className="text-gray-500 text-sm px-2 py-2 text-center">
                {t('sidebar.noAgents')}
              </div>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};

export default React.memo(MessagingSidebar);
