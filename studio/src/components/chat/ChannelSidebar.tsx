import React, { useState } from 'react';
import { ThreadMessagingChannel, AgentInfo } from '../../services/openagentsService';

interface ChannelSidebarProps {
  channels: ThreadMessagingChannel[];
  agents: AgentInfo[];
  currentChannel: string | null;
  currentDirectMessage: string | null;
  onSelectChannel: (channelName: string) => void;
  onSelectDirectMessage: (agentId: string) => void;
  currentTheme: 'light' | 'dark';
}

const styles = `
  .channel-sidebar {
    width: 280px;
    background: #f8fafc;
    border-right: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    height: 100%;
    flex-shrink: 0;
  }
  
  .channel-sidebar.dark {
    background: #1e293b;
    border-right: 1px solid #334155;
  }
  
  .sidebar-header {
    padding: 20px 16px 16px;
    border-bottom: 1px solid #e2e8f0;
    background: #ffffff;
  }
  
  .sidebar-header.dark {
    background: #0f172a;
    border-bottom: 1px solid #334155;
  }
  
  .network-title {
    font-size: 18px;
    font-weight: 700;
    color: #1e293b;
    margin: 0 0 4px 0;
  }
  
  .network-title.dark {
    color: #f1f5f9;
  }
  
  .network-subtitle {
    font-size: 14px;
    color: #64748b;
    margin: 0;
  }
  
  .network-subtitle.dark {
    color: #94a3b8;
  }
  
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0;
  }
  
  .section {
    margin-bottom: 24px;
  }
  
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px 8px;
    font-size: 14px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .section-header.dark {
    color: #94a3b8;
  }
  
  .section-toggle {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 12px;
  }
  
  .channel-item, .agent-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    margin: 0 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: 15px;
    position: relative;
  }
  
  .channel-item:hover, .agent-item:hover {
    background: #e2e8f0;
  }
  
  .channel-item.active, .agent-item.active {
    background: #3b82f6;
    color: white;
  }
  
  .channel-item.dark:hover, .agent-item.dark:hover {
    background: #334155;
  }
  
  .channel-item.dark, .agent-item.dark {
    color: #e2e8f0;
  }
  
  .channel-item.active.dark, .agent-item.active.dark {
    background: #3b82f6;
    color: white;
  }
  
  .channel-prefix {
    margin-right: 8px;
    font-weight: 600;
    color: #64748b;
  }
  
  .channel-item.active .channel-prefix,
  .agent-item.active .agent-prefix {
    color: rgba(255, 255, 255, 0.8);
  }
  
  .channel-item.dark .channel-prefix {
    color: #94a3b8;
  }
  
  .agent-prefix {
    margin-right: 8px;
    font-weight: 600;
    color: #64748b;
  }
  
  .agent-item.dark .agent-prefix {
    color: #94a3b8;
  }
  
  .channel-name, .agent-name {
    flex: 1;
    font-weight: 500;
  }
  
  .channel-item.active .channel-name,
  .agent-item.active .agent-name {
    color: white;
  }
  
  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-left: 8px;
    flex-shrink: 0;
  }
  
  .status-online {
    background: #10b981;
  }
  
  .status-away {
    background: #f59e0b;
  }
  
  .status-offline {
    background: #64748b;
  }
  
  .message-count {
    background: #ef4444;
    color: white;
    font-size: 12px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    margin-left: 8px;
    min-width: 18px;
    text-align: center;
  }
  
  .agent-count {
    color: #64748b;
    font-size: 12px;
    font-weight: 500;
  }
  
  .section-header.dark .agent-count {
    color: #94a3b8;
  }
  
  .empty-state {
    padding: 16px;
    text-align: center;
    color: #64748b;
    font-size: 14px;
    font-style: italic;
  }
  
  .empty-state.dark {
    color: #94a3b8;
  }
  
  .collapsible-section {
    transition: all 0.2s ease;
  }
  
  .section-content {
    transition: max-height 0.2s ease;
    overflow: hidden;
  }
  
  .section-content.collapsed {
    max-height: 0;
  }
  
  .section-content.expanded {
    max-height: 1000px;
  }
  
  .sidebar-footer {
    padding: 16px;
    border-top: 1px solid #e2e8f0;
    background: #ffffff;
    font-size: 12px;
    color: #64748b;
    text-align: center;
  }
  
  .sidebar-footer.dark {
    background: #0f172a;
    border-top: 1px solid #334155;
    color: #94a3b8;
  }
`;

const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  channels = [],
  agents = [],
  currentChannel,
  currentDirectMessage,
  onSelectChannel,
  onSelectDirectMessage,
  currentTheme
}) => {
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);

  const getStatusIndicator = (agent: AgentInfo) => {
    const status = agent.metadata?.status || 'offline';
    return `status-${status}`;
  };

  const formatAgentName = (agent: AgentInfo) => {
    return agent.metadata?.display_name || agent.agent_id;
  };

  const totalChannelMessages = Array.isArray(channels) 
    ? channels.reduce((sum, channel) => sum + (channel.message_count || 0), 0)
    : 0;
  const onlineAgents = Array.isArray(agents) 
    ? agents.filter(agent => agent.metadata?.status === 'online').length
    : 0;

  return (
    <div className={`channel-sidebar ${currentTheme}`}>
      <style>{styles}</style>
      
      <div className={`sidebar-header ${currentTheme}`}>
        <h2 className={`network-title ${currentTheme}`}>
          Thread Messaging
        </h2>
        <p className={`network-subtitle ${currentTheme}`}>
          {channels.length} channels • {agents.length} agents
        </p>
      </div>
      
      <div className="sidebar-content">
        {/* Channels Section */}
        <div className={`section collapsible-section ${channelsCollapsed ? 'collapsed' : ''}`}>
          <div className={`section-header ${currentTheme}`}>
            <span>Channels ({channels.length})</span>
            <button
              className="section-toggle"
              onClick={() => setChannelsCollapsed(!channelsCollapsed)}
            >
              {channelsCollapsed ? '▶' : '▼'}
            </button>
          </div>
          
          <div className={`section-content ${channelsCollapsed ? 'collapsed' : 'expanded'}`}>
            {Array.isArray(channels) && channels.length > 0 ? (
              channels.map((channel) => (
                <div
                  key={channel.name}
                  className={`channel-item ${currentTheme} ${
                    currentChannel === channel.name ? 'active' : ''
                  }`}
                  onClick={() => onSelectChannel(channel.name)}
                >
                  <span className="channel-prefix">#</span>
                  <span className="channel-name">{channel.name}</span>
                  {channel.message_count > 0 && (
                    <span className="message-count">{channel.message_count}</span>
                  )}
                </div>
              ))
            ) : (
              <div className={`empty-state ${currentTheme}`}>
                No channels available
              </div>
            )}
          </div>
        </div>

        {/* Direct Messages Section */}
        <div className={`section collapsible-section ${agentsCollapsed ? 'collapsed' : ''}`}>
          <div className={`section-header ${currentTheme}`}>
            <span>
              Direct Messages 
              <span className="agent-count"> ({onlineAgents}/{agents.length} online)</span>
            </span>
            <button
              className="section-toggle"
              onClick={() => setAgentsCollapsed(!agentsCollapsed)}
            >
              {agentsCollapsed ? '▶' : '▼'}
            </button>
          </div>
          
          <div className={`section-content ${agentsCollapsed ? 'collapsed' : 'expanded'}`}>
            {Array.isArray(agents) && agents.length > 0 ? (
              agents
                .sort((a, b) => {
                  // Sort by status (online first), then by name
                  const statusOrder = { online: 0, away: 1, offline: 2 };
                  const aStatus = statusOrder[a.metadata?.status as keyof typeof statusOrder] ?? 2;
                  const bStatus = statusOrder[b.metadata?.status as keyof typeof statusOrder] ?? 2;
                  
                  if (aStatus !== bStatus) {
                    return aStatus - bStatus;
                  }
                  
                  return formatAgentName(a).localeCompare(formatAgentName(b));
                })
                .map((agent) => (
                  <div
                    key={agent.agent_id}
                    className={`agent-item ${currentTheme} ${
                      currentDirectMessage === agent.agent_id ? 'active' : ''
                    }`}
                    onClick={() => onSelectDirectMessage(agent.agent_id)}
                  >
                    <span className="agent-prefix">@</span>
                    <span className="agent-name">{formatAgentName(agent)}</span>
                    <div className={`status-indicator ${getStatusIndicator(agent)}`} />
                  </div>
                ))
            ) : (
              <div className={`empty-state ${currentTheme}`}>
                No agents online
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className={`sidebar-footer ${currentTheme}`}>
        <div>Connected to OpenAgents Network</div>
        <div>
          {totalChannelMessages} total messages • Thread Messaging v1.0
        </div>
      </div>
    </div>
  );
};

export default ChannelSidebar;
