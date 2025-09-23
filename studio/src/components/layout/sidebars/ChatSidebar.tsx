import React from "react";
import { ThreadChannel, AgentInfo } from "@/types/events";
import { useThreadStore } from "@/stores/threadStore";
import { useChannelMessages } from "@/hooks/useChannelMessages";
import { useDirectMessages } from "@/hooks/useDirectMessages";
import { useOpenAgentsService } from "@/contexts/OpenAgentsServiceContext";
import { useNetworkStore } from "@/stores/networkStore";

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
        ${
          isActive
            ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
            : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
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
        ${
          isActive
            ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
            : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
        }
      `}
      title={agent.metadata?.display_name || agent.agent_id}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <div
            className={`w-2 h-2 rounded-full mr-2 ${
              agent.metadata?.status === "online"
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

// Chat Sidebar Content Component - 使用新的hooks获取数据
const ChatSidebar: React.FC = () => {
  const {
    getCurrentChannel,
    getCurrentDirectMessage,
    updateThreadState,
  } = useThreadStore();

  const { connectionStatus, isConnected } = useOpenAgentsService();
  const { agentName } = useNetworkStore();

  // 使用agentName作为fallback，如果connectionStatus.agentId不可用
  const currentUserId = connectionStatus.agentId || agentName || undefined;

  // 使用新的hooks获取数据
  const channelMessages = useChannelMessages({
    autoLoadChannels: true,
    currentUserId,
  });

  const directMessages = useDirectMessages({
    autoLoadAgents: true,
    currentUserId,
  });

  // 调试信息
  console.log('ChatSidebar Debug:', {
    connectionStatus: connectionStatus.status,
    connectionAgentId: connectionStatus.agentId,
    networkAgentName: agentName,
    currentUserId,
    isConnected,
    channelsCount: channelMessages.channels.length,
    agentsCount: directMessages.agents.length,
    isChannelLoading: channelMessages.isLoading,
    isDirectLoading: directMessages.isLoading,
  });

  // 获取数据
  const channels: ThreadChannel[] = channelMessages.channels;
  const agents: AgentInfo[] = directMessages.agents;
  const currentChannel: string | null = getCurrentChannel();
  const currentDirectMessage: string | null = getCurrentDirectMessage();

  // TODO: 实现 unreadCounts 逻辑
  const unreadCounts: Record<string, number> = {};

  // 频道选择处理
  const onChannelSelect = (channel: string) => {
    updateThreadState({
      currentChannel: channel,
      currentDirectMessage: null, // 切换到频道时清除私信选择
    });
    // 触发频道消息的加载
    channelMessages.setCurrentChannel(channel);
  };

  // 私信选择处理
  const onDirectMessageSelect = (agentId: string) => {
    updateThreadState({
      currentDirectMessage: agentId,
      currentChannel: null, // 切换到私信时清除频道选择
    });
    // 触发私信的加载
    directMessages.setTargetUser(agentId);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Channels Section */}
      <SectionHeader title="CHANNELS" />
      <div className="px-3">
        {channelMessages.isLoading && channels.length === 0 ? (
          <div className="text-gray-500 text-sm px-2 py-2">Loading channels...</div>
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
            {channels.length === 0 && !channelMessages.isLoading && (
              <div className="text-gray-500 text-sm px-2 py-2">No channels available</div>
            )}
          </ul>
        )}
      </div>

      {/* Direct Messages Section */}
      <SectionHeader title="DIRECT MESSAGES" />
      <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
        {directMessages.isLoading && agents.length === 0 ? (
          <div className="text-gray-500 text-sm px-2 py-2">Loading agents...</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {agents.map((agent) => (
              <AgentItem
                key={agent.agent_id}
                agent={agent}
                isActive={currentDirectMessage === agent.agent_id}
                unreadCount={unreadCounts[agent.agent_id] || 0}
                onClick={() => onDirectMessageSelect(agent.agent_id)}
              />
            ))}
            {agents.length === 0 && !directMessages.isLoading && (
              <div className="text-gray-500 text-sm px-2 py-2">No agents online</div>
            )}
          </ul>
        )}
      </div>
    </div>
  );
};

export default React.memo(ChatSidebar);
