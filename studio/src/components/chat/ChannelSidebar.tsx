import React, { useState } from 'react';
import { ThreadMessagingChannel, AgentInfo } from '../../services/openagentsService';
import OpenAgentsLogo from '../icons/OpenAgentsLogo';

interface ChannelSidebarProps {
  channels: ThreadMessagingChannel[];
  agents: AgentInfo[];
  currentChannel: string | null;
  currentDirectMessage: string | null;
  onSelectChannel: (channelName: string) => void;
  onSelectDirectMessage: (agentId: string) => void;
  currentTheme: 'light' | 'dark';
  currentNetwork?: { host: string; port: number };
  onProfileClick?: () => void;
  toggleTheme?: () => void;
  unreadCounts?: Record<string, number>;
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
  
  .logo-section {
    padding: 20px 16px;
    border-bottom: 1px solid #e2e8f0;
    background: #ffffff;
  }
  
  .logo-section.dark {
    background: #0f172a;
    border-bottom: 1px solid #334155;
  }
  
  .logo-container {
    display: flex;
    align-items: center;
    margin-bottom: 0;
  }
  
  .logo-text {
    font-size: 20px;
    font-weight: 700;
    background: linear-gradient(to right, #4f46e5, #7c3aed);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-left: 8px;
  }
  
  .logo-text.dark {
    background: none;
    -webkit-text-fill-color: white;
    color: white;
  }
  
  .profile-section {
    margin-top: auto;
    padding: 12px 16px;
    border-top: 1px solid #e2e8f0;
  }
  
  .profile-section.dark {
    border-top: 1px solid #334155;
  }
  
  .profile-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .profile-info {
    display: flex;
    align-items: center;
  }
  
  .profile-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #10b981;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 8px;
  }
  
  .profile-details {
    display: flex;
    flex-direction: column;
  }
  
  .profile-status {
    font-weight: 500;
    font-size: 14px;
    color: #111827;
  }
  
  .profile-status.dark {
    color: #f9fafb;
  }
  
  .profile-network {
    font-size: 12px;
    color: #6b7280;
    max-width: 130px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .profile-network.dark {
    color: #9ca3af;
  }
  
  .profile-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .profile-button {
    padding: 6px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .profile-button:hover {
    background: #e5e7eb;
    color: #374151;
  }
  
  .profile-button.dark {
    color: #9ca3af;
  }
  
  .profile-button.dark:hover {
    background: #374151;
    color: #e5e7eb;
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

  .unread-badge {
    background: #ef4444;
    color: white;
    border-radius: 10px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    min-width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
  }

  .unread-badge.dark {
    background: #dc2626;
  }

  .channel-item-container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .agent-item-container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .channel-content {
    display: flex;
    align-items: center;
    flex: 1;
  }

  .agent-content {
    display: flex;
    align-items: center;
    flex: 1;
  }
`;

const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  channels = [],
  agents = [],
  currentChannel,
  currentDirectMessage,
  onSelectChannel,
  onSelectDirectMessage,
  currentTheme,
  currentNetwork,
  onProfileClick,
  toggleTheme,
  unreadCounts = {}
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
      
      {/* Logo Section */}
      <div className={`logo-section ${currentTheme}`}>
        <div className="logo-container">
          <OpenAgentsLogo className="w-10 h-10 text-gray-900 dark:text-white" />
          <span className={`logo-text ${currentTheme}`}>OpenAgents Studio</span>
        </div>
      </div>
      
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
                  <div className="channel-item-container">
                    <div className="channel-content">
                      <span className="channel-prefix">#</span>
                      <span className="channel-name">{channel.name}</span>
                    </div>
                    {unreadCounts[channel.name] > 0 && (
                      <div className={`unread-badge ${currentTheme}`}>
                        {unreadCounts[channel.name]}
                      </div>
                    )}
                  </div>
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
                    <div className="agent-item-container">
                      <div className="agent-content">
                        <span className="agent-prefix">@</span>
                        <span className="agent-name">{formatAgentName(agent)}</span>
                        <div className={`status-indicator ${getStatusIndicator(agent)}`} />
                      </div>
                      {unreadCounts[agent.agent_id] > 0 && (
                        <div className={`unread-badge ${currentTheme}`}>
                          {unreadCounts[agent.agent_id]}
                        </div>
                      )}
                    </div>
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
      
      {/* Profile Section */}
      <div className={`profile-section ${currentTheme}`}>
        <div className="profile-content">
          <div className="profile-info">
            <div className="profile-avatar">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"/>
              </svg>
            </div>
            <div className="profile-details">
              <span className={`profile-status ${currentTheme}`}>Connected</span>
              {currentNetwork && (
                <span className={`profile-network ${currentTheme}`}>
                  {currentNetwork.host}:{currentNetwork.port}
                </span>
              )}
            </div>
          </div>
          <div className="profile-actions">
            {toggleTheme && (
              <button
                onClick={toggleTheme}
                className={`profile-button ${currentTheme}`}
                aria-label={currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {currentTheme === 'dark' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06l-1.06-1.06a.75.75 0 10-1.061 1.06l1.06 1.06z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )}
            {onProfileClick && (
              <button
                onClick={onProfileClick}
                className={`profile-button ${currentTheme}`}
                aria-label="Profile settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.27-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChannelSidebar;
