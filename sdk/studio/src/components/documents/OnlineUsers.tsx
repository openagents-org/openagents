import React, { useState } from 'react';
import { CollaborationUser } from '@/services/collaborationService';

interface OnlineUsersProps {
  users: CollaborationUser[];
  theme: 'light' | 'dark';
  className?: string;
}

const OnlineUsersList: React.FC<OnlineUsersProps> = ({
  users,
  theme,
  className = ''
}) => {
  const [showDetails, setShowDetails] = useState(false);

  if (users.length === 0) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          No online users
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* User avatar group */}
      <div
        className="flex items-center space-x-1 cursor-pointer"
        onClick={() => setShowDetails(!showDetails)}
        onMouseEnter={() => setShowDetails(true)}
        onMouseLeave={() => setShowDetails(false)}
      >
        {/* Display first 5 user avatars */}
        {users.slice(0, 5).map((user, index) => (
          <div
            key={user.id}
            className="relative"
            style={{ zIndex: 5 - index }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium ring-2 ring-white dark:ring-gray-800 transition-transform hover:scale-110"
              style={{
                backgroundColor: user.color,
                marginLeft: index > 0 ? '-4px' : '0'
              }}
              title={user.name}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>

            {/* Active indicator */}
            {user.cursor && (
              <div
                className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800"
                style={{ backgroundColor: user.color }}
              >
                <div className="w-full h-full rounded-full bg-green-500 animate-pulse"></div>
              </div>
            )}
          </div>
        ))}

        {/* More users indicator */}
        {users.length > 5 && (
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ring-2 ring-white dark:ring-gray-800
            ${theme === 'dark' ? 'bg-gray-600 text-gray-200' : 'bg-gray-400 text-white'}
          `}>
            +{users.length - 5}
          </div>
        )}

        {/* Online count */}
        <div className={`text-sm ml-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          {users.length} online
        </div>
      </div>

      {/* Detailed user list */}
      {showDetails && (
        <div
          className={`
            absolute top-full right-0 mt-2 w-72 rounded-lg shadow-lg border z-50
            ${theme === 'dark'
              ? 'bg-gray-800 border-gray-700'
              : 'bg-white border-gray-200'
            }
          `}
          onMouseEnter={() => setShowDetails(true)}
          onMouseLeave={() => setShowDetails(false)}
        >
          <div className="p-3">
            <div className={`text-sm font-medium mb-3 ${
              theme === 'dark' ? 'text-gray-200' : 'text-gray-800'
            }`}>
              Online Users ({users.length})
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {users.map((user) => (
                <div
                  key={user.id}
                  className={`
                    flex items-center space-x-3 p-2 rounded-lg transition-colors
                    ${theme === 'dark'
                      ? 'hover:bg-gray-700'
                      : 'hover:bg-gray-50'
                    }
                  `}
                >
                  {/* User avatar */}
                  <div className="relative">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                      style={{ backgroundColor: user.color }}
                    >
                      {user.name.charAt(0).toUpperCase()}
                    </div>

                    {/* Active status indicator */}
                    <div className={`
                      absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800
                      ${user.cursor ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}
                    `}></div>
                  </div>

                  {/* User information */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${
                      theme === 'dark' ? 'text-gray-200' : 'text-gray-800'
                    }`}>
                      {user.name}
                    </div>

                    <div className={`text-xs ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {user.cursor ? (
                        <span className="flex items-center">
                          <span className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                          Editing line {user.cursor.line}
                        </span>
                      ) : (
                        <span className="flex items-center">
                          <span className="w-2 h-2 bg-gray-400 rounded-full mr-1"></span>
                          Idle
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Color indicator */}
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: user.color }}
                  ></div>
                </div>
              ))}
            </div>

            {/* Footer information */}
            <div className={`
              mt-3 pt-3 border-t text-xs text-center
              ${theme === 'dark'
                ? 'border-gray-700 text-gray-400'
                : 'border-gray-200 text-gray-600'
              }
            `}>
              Real-time collaboration mode · All changes auto-synced
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnlineUsersList;