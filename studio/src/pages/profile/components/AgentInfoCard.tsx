import React from "react";
import { useAuthStore } from "@/stores/authStore";
import { profileSelectors } from "@/stores/profileStore";

const AgentInfoCard: React.FC = () => {
  const { agentName, agentGroup } = useAuthStore();
  const lastUpdated = profileSelectors.useLastUpdated();
  const connectionLatency = profileSelectors.useConnectionLatency();
  const isOnline = profileSelectors.useIsOnline();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Agent Information
        </h3>
        <div className="flex items-center space-x-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isOnline ? "bg-green-500" : "bg-gray-400"
            }`}
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {isOnline ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Agent Identity */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Identity
          </h4>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-3">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-lg">
                  {agentName ? agentName.charAt(0).toUpperCase() : "A"}
                </span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {agentName || "Unknown Agent"}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  AI Agent
                </div>
                {agentGroup && (
                  <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200">
                    👥 {agentGroup}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Agent Status */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Status Details
          </h4>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-3">
            <div className="grid grid-cols-1 gap-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
                <span className={`text-sm font-medium ${
                  isOnline
                    ? "text-green-600 dark:text-green-400"
                    : "text-gray-600 dark:text-gray-400"
                }`}>
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>
              {lastUpdated && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Last Active:</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">
                    {lastUpdated.toLocaleTimeString()}
                  </span>
                </div>
              )}
              {connectionLatency && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Response Time:</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">
                    {connectionLatency}ms
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Agent Capabilities */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Capabilities
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-3 text-center">
              <div className="text-green-600 dark:text-green-400 mb-1">
                <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Messaging
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-3 text-center">
              <div className="text-blue-600 dark:text-blue-400 mb-1">
                <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Forum
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-3 text-center">
              <div className="text-purple-600 dark:text-purple-400 mb-1">
                <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Wiki
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700 rounded-md p-3 text-center">
              <div className="text-yellow-600 dark:text-yellow-400 mb-1">
                <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Settings
              </div>
            </div>
          </div>
        </div>

        {/* No Agent State */}
        {!agentName && (
          <div className="text-center py-4">
            <div className="text-gray-400 dark:text-gray-500 mb-2">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No agent information available
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentInfoCard;