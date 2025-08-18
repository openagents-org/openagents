import React from 'react';
import { SidebarProps } from '../types';
import OpenAgentsLogo from './icons/OpenAgentsLogo';

const Sidebar: React.FC<Omit<SidebarProps, 'isCollapsed' | 'toggleSidebar'>> = ({
  onSettingsClick,
  onProfileClick,
  onMcpClick,
  activeView,
  onConversationChange,
  activeConversationId,
  conversations,
  createNewConversation,
  toggleTheme,
  currentTheme,
  currentNetwork
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

        {/* Start New Chat Button */}
        <button
          onClick={createNewConversation}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-sm font-semibold shadow-md hover:from-indigo-600 hover:to-purple-600 transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New chat
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 flex flex-col mt-4 overflow-hidden">
        <div className="px-5">
          <div className="flex items-center mb-2">
            <div className="text-xs font-bold text-gray-400 tracking-wide select-none">CHAT HISTORY</div>
            <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
          </div>
        </div>
        
        {/* Chat History List - Scrollable */}
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
      </div>

      {/* MCP Button */}
      <div className="mt-auto px-4 pt-2 pb-2">
        <button
          onClick={onMcpClick}
          className={`relative group flex items-center w-full rounded-lg px-4 py-3.5 text-sm transition-all
            ${activeView === 'mcp'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium shadow-md'
              : 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 text-indigo-700 dark:text-indigo-300 font-medium border border-indigo-100 dark:border-indigo-800/50 hover:shadow-md hover:from-indigo-100 hover:to-purple-100 dark:hover:from-indigo-800/30 dark:hover:to-purple-800/30'}
          `}
        >
          {/* Background decoration */}
          <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
            <div className="absolute -right-6 -top-6 w-12 h-12 rounded-full bg-blue-500/20 dark:bg-blue-400/10"></div>
            <div className="absolute -right-4 bottom-0 w-8 h-8 rounded-full bg-indigo-400/20 dark:bg-indigo-400/10"></div>
          </div>
          
          {/* Icon container with glowing effect */}
          <div className="flex-shrink-0 mr-3 relative z-10">
            <div className={`p-1.5 rounded-lg ${activeView === 'mcp' ? 'bg-white/20' : 'bg-indigo-200/50 dark:bg-indigo-800/30 group-hover:bg-indigo-300/50 dark:group-hover:bg-indigo-700/30'} transition-all`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M6 2a2 2 0 00-2 2v2h2V4h12v2h2V4a2 2 0 00-2-2H6zM4 8v12c0 1.1.9 2 2 2h12a2 2 0 002-2V8H4zm18-6h2v20H0V2h2zm-8 9h3v3h-3v-3zm-5 0h3v3H9v-3zM4 17h3v3H4v-3zm5 0h3v3H9v-3zm5 0h3v3h-3v-3zm5-5h-3v3h3v-3z"/>
              </svg>
            </div>
            
            {/* Notification dot */}
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 dark:bg-blue-300"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500 dark:bg-blue-400"></span>
            </span>
          </div>
          
          {/* Text content with subtle effects */}
          <div className="flex-1 flex flex-col items-start z-10">
            <span className="font-semibold tracking-wide">MCP Store</span>
            <span className={`text-xs ${activeView === 'mcp' ? 'text-blue-100' : 'text-indigo-500 dark:text-indigo-400'}`}>
              Browse AI plugins & tools
            </span>
          </div>
          
          {/* Arrow icon */}
          <span className="ml-2 opacity-70">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </button>
      </div>

      {/* User Info / Profile Section */}
      <div className="mt-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center mr-2">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"/>
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">Connected</span>
              {currentNetwork && (
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[130px]">
                  {currentNetwork.host}:{currentNetwork.port}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
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
            <button
              onClick={onProfileClick}
              className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Profile settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.27-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar; 