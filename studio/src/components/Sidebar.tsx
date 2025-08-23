import React from 'react';
import { SidebarProps } from '../types';
import { ThreadMessagingChannel, AgentInfo } from '../services/openagentsService';
import OpenAgentsLogo from './icons/OpenAgentsLogo';

interface ExtendedSidebarProps extends Omit<SidebarProps, 'isCollapsed' | 'toggleSidebar'> {
  // Thread messaging data
  channels?: ThreadMessagingChannel[];
  agents?: AgentInfo[];
  currentChannel?: string | null;
  currentDirectMessage?: string | null;
  unreadCounts?: Record<string, number>;
  onChannelSelect?: (channel: string) => void;
  onDirectMessageSelect?: (agentId: string) => void;
  showThreadMessaging?: boolean;
  agentName?: string | null;
}

const Sidebar: React.FC<ExtendedSidebarProps> = ({
  onSettingsClick,
  onProfileClick,
  onMcpClick,
  onDocumentsClick,
  activeView,
  onConversationChange,
  activeConversationId,
  conversations,
  createNewConversation,
  toggleTheme,
  currentTheme,
  currentNetwork,
  hasSharedDocuments = false,
  // Thread messaging props
  channels = [],
  agents = [],
  currentChannel = null,
  currentDirectMessage = null,
  unreadCounts = {},
  onChannelSelect,
  onDirectMessageSelect,
  showThreadMessaging = false,
  agentName = null
}) => {
  return (
    <div className="sidebar h-full flex flex-col transition-all duration-200 bg-slate-100 dark:bg-gray-900" style={{ width: '19rem' }}>
      {/* Top Section */}
      <div className="flex flex-col px-5 py-5">
        {/* Brand */}
        <div className="flex items-center mb-6">
          <OpenAgentsLogo className="w-10 h-10 mr-2 text-gray-900 dark:text-white" />
          <span className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent dark:bg-none dark:text-white">OpenAgents Studio</span>
        </div>


      </div>

      {/* Thread Messaging or Chat History */}
      <div className="flex-1 flex flex-col mt-4 overflow-hidden">
        {showThreadMessaging ? (
          <>
            {/* Debug info - console.log moved inside IIFE to avoid JSX children issues */}
            
            {/* Channels Section */}
            <div className="px-5">
              <div className="flex items-center mb-2">
                <div className="text-xs font-bold text-gray-400 tracking-wide select-none">CHANNELS</div>
                <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
              </div>
            </div>
            
            <div className="px-3 mb-4">
              <ul className="flex flex-col gap-1">
                {channels.map(channel => (
                  <li key={channel.name}>
                    <button
                      onClick={() => onChannelSelect?.(channel.name)}
                      className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
                        ${currentChannel === channel.name
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5'}
                      `}
                      title={channel.description || channel.name}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center min-w-0">
                          <span className="mr-2 text-gray-400">#</span>
                          <span className="truncate">{channel.name}</span>
                        </div>
                        {unreadCounts[channel.name] > 0 && (
                          <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                            {unreadCounts[channel.name] > 99 ? '99+' : unreadCounts[channel.name]}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Direct Messages Section */}
            <div className="px-5">
              <div className="flex items-center mb-2">
                <div className="text-xs font-bold text-gray-400 tracking-wide select-none">DIRECT MESSAGES</div>
                <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
              <ul className="flex flex-col gap-1">
                {agents.map(agent => (
                  <li key={agent.agent_id}>
                    <button
                      onClick={() => onDirectMessageSelect?.(agent.agent_id)}
                      className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
                        ${currentDirectMessage === agent.agent_id
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5'}
                      `}
                      title={agent.metadata?.display_name || agent.agent_id}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center min-w-0">
                          <div className={`w-2 h-2 rounded-full mr-2 ${agent.metadata?.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                          <span className="truncate">{agent.metadata?.display_name || agent.agent_id}</span>
                        </div>
                        {unreadCounts[agent.agent_id] > 0 && (
                          <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                            {unreadCounts[agent.agent_id] > 99 ? '99+' : unreadCounts[agent.agent_id]}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <>
            {/* Original Chat History */}
            <div className="px-5">
              <div className="flex items-center mb-2">
                <div className="text-xs font-bold text-gray-400 tracking-wide select-none">CHAT HISTORY</div>
                <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
              <ul className="flex flex-col gap-1">
                {conversations.map(conv => (
                  <li key={conv.id}>
                    <button
                      onClick={() => onConversationChange(conv.id)}
                      className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
                        ${conv.id === activeConversationId
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5'}
                      `}
                      title={conv.title}
                    >
                      <div className="flex items-center">
                        <span className="mr-2">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                        </span>
                        {conv.title}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Documents Button - Show if shared document mod is available */}
      {hasSharedDocuments && onDocumentsClick && (
        <div className="px-4 pt-2">
          <button
            onClick={onDocumentsClick}
            className={`relative group flex items-center w-full rounded-lg px-4 py-3.5 text-sm transition-all
              ${activeView === 'documents'
                ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white font-medium shadow-md'
                : 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 text-green-700 dark:text-green-300 font-medium border border-green-100 dark:border-green-800/50 hover:shadow-md hover:from-green-100 hover:to-emerald-100 dark:hover:from-green-800/30 dark:hover:to-emerald-800/30'}
            `}
          >
            <div className="flex items-center">
              <div className="mr-3 p-1.5 rounded-md bg-white/20">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex flex-col items-start">
                <span className="font-medium">Documents</span>
                <span className="text-xs opacity-75">Collaborative editing</span>
              </div>
            </div>
            <div className="ml-auto">
              <svg className="w-4 h-4 opacity-50 group-hover:opacity-75 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      )}

      {/* MCP Store Button */}
      <div className="px-4 pt-2">
        <button
          onClick={onMcpClick}
          className={`relative group flex items-center w-full rounded-lg px-4 py-3.5 text-sm transition-all
            ${activeView === 'mcp'
              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium shadow-md'
              : 'bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 font-medium border border-purple-100 dark:border-purple-800/50 hover:shadow-md hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-800/30 dark:hover:to-pink-800/30'}
          `}
        >
          <div className="flex items-center">
            <div className="mr-3 p-1.5 rounded-md bg-white/20">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <div className="flex flex-col items-start">
              <span className="font-medium">MCP Store</span>
              <span className="text-xs opacity-75">Browse AI plugins & tools</span>
            </div>
          </div>
          <div className="ml-auto">
            <svg className="w-4 h-4 opacity-50 group-hover:opacity-75 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>

      {/* Bottom Section */}
      <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-700">
        {/* Connection Status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center text-sm">
            <div className={`w-2 h-2 rounded-full mr-2 ${currentNetwork ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-gray-600 dark:text-gray-300 font-medium">
              {currentNetwork ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title={`Switch to ${currentTheme === 'light' ? 'dark' : 'light'} mode`}
          >
            {currentTheme === 'light' ? (
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
        </div>

        {/* Network Info */}
        {currentNetwork && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {currentNetwork.host}:{currentNetwork.port}
          </div>
        )}

        {/* Settings and Profile Buttons */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={onSettingsClick}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors
              ${activeView === 'settings'
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}
            `}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
          <button
            onClick={onProfileClick}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors
              ${activeView === 'profile'
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}
            `}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Profile
          </button>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;