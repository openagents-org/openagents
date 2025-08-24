import React from 'react';

interface ModSidebarProps {
  activeView: 'chat' | 'documents' | 'settings' | 'profile' | 'mcp';
  setActiveView: (view: 'chat' | 'documents' | 'settings' | 'profile' | 'mcp') => void;
  currentTheme: 'light' | 'dark';
  hasSharedDocuments: boolean;
  hasThreadMessaging: boolean;
}

interface ModIconProps {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  theme: 'light' | 'dark';
  hasNotification?: boolean;
}

const ModIcon: React.FC<ModIconProps> = ({ 
  isActive, 
  onClick, 
  icon, 
  label, 
  theme, 
  hasNotification = false 
}) => {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`
          w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 relative
          ${isActive 
            ? theme === 'dark' 
              ? 'bg-blue-600 text-white shadow-lg' 
              : 'bg-blue-600 text-white shadow-lg'
            : theme === 'dark'
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
              : 'bg-gray-200 text-gray-600 hover:bg-gray-300 hover:text-gray-800'
          }
          hover:scale-105 active:scale-95
        `}
        title={label}
      >
        {icon}
        {hasNotification && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-gray-800"></div>
        )}
      </button>
      
      {/* Tooltip */}
      <div className={`
        absolute left-16 top-1/2 transform -translate-y-1/2 px-2 py-1 rounded-md text-sm font-medium
        opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50
        ${theme === 'dark' 
          ? 'bg-gray-800 text-white border border-gray-600' 
          : 'bg-gray-900 text-white'
        }
        shadow-lg whitespace-nowrap
      `}>
        {label}
        <div className={`
          absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-2 h-2 rotate-45
          ${theme === 'dark' ? 'bg-gray-800 border-l border-b border-gray-600' : 'bg-gray-900'}
        `}></div>
      </div>
    </div>
  );
};

const ModSidebar: React.FC<ModSidebarProps> = ({
  activeView,
  setActiveView,
  currentTheme,
  hasSharedDocuments,
  hasThreadMessaging
}) => {
  return (
    <div className={`
      w-16 h-full flex flex-col items-center py-4 border-r transition-colors duration-200
      ${currentTheme === 'dark' 
        ? 'bg-gray-900 border-gray-700' 
        : 'bg-gray-100 border-gray-200'
      }
    `}>
      {/* Logo/Brand Icon */}
      <div className="mb-6">
        <div className={`
          w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg
          ${currentTheme === 'dark' 
            ? 'bg-gradient-to-br from-blue-600 to-purple-600 text-white' 
            : 'bg-gradient-to-br from-blue-600 to-purple-600 text-white'
          }
          shadow-lg
        `}>
          OA
        </div>
      </div>

      {/* Mod Icons */}
      <div className="flex flex-col space-y-3 flex-1">
        {/* Thread Messaging / Chat */}
        {hasThreadMessaging && (
          <ModIcon
            isActive={activeView === 'chat'}
            onClick={() => setActiveView('chat')}
            theme={currentTheme}
            label="Messages"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            }
          />
        )}

        {/* Shared Documents */}
        {hasSharedDocuments && (
          <ModIcon
            isActive={activeView === 'documents'}
            onClick={() => setActiveView('documents')}
            theme={currentTheme}
            label="Documents"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />
        )}
      </div>

      {/* Bottom Icons */}
      <div className="flex flex-col space-y-3 mt-auto">
        {/* Settings */}
        <ModIcon
          isActive={activeView === 'settings'}
          onClick={() => setActiveView('settings')}
          theme={currentTheme}
          label="Settings"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />

        {/* Profile */}
        <ModIcon
          isActive={activeView === 'profile'}
          onClick={() => setActiveView('profile')}
          theme={currentTheme}
          label="Profile"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          }
        />

        {/* MCP (if needed) */}
        <ModIcon
          isActive={activeView === 'mcp'}
          onClick={() => setActiveView('mcp')}
          theme={currentTheme}
          label="MCP"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          }
        />
      </div>
    </div>
  );
};

export default ModSidebar;

