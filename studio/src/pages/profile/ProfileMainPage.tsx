import React from "react";
import { Routes, Route } from "react-router-dom";
import { useProfileData } from "./hooks/useProfileData";

// Components (to be created)
import NetworkInfoCard from "./components/NetworkInfoCard";
import ModulesInfoCard from "./components/ModulesInfoCard";
import AgentInfoCard from "./components/AgentInfoCard";
import SystemInfoCard from "./components/SystemInfoCard";
import AgentManagement from "./AgentManagement";
import NetworkProfile from "./NetworkProfile";
import EventLogs from "./EventLogs";
import EventDebugger from "./EventDebugger";

/**
 * 个人资料主页面 - 处理个人资料相关的所有功能
 */
const ProfileMainPage: React.FC = () => {
  return (

    <Routes>

      {/* 默认个人资料视图 */}
      <Route index element={<ProfileDashboard />} />

      {/* Profile edit subpage */}
      <Route
        path="edit"
        element={
          <div className="p-6 dark:bg-gray-900 h-full">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Edit Profile
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Profile editing form coming soon...
            </p>
          </div>
        }
      />

      {/* Security settings subpage */}
      <Route
        path="security"
        element={
          <div className="p-6 dark:bg-gray-900 h-full">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Security Settings
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Security configuration panel coming soon...
            </p>
          </div>
        }
      />

      {/* Agent Management subpage - Admin only */}
      <Route path="agent-management" element={<AgentManagement />} />
      <Route path="network-profile" element={<NetworkProfile />} />
      
      {/* Event Logs subpage */}
      <Route path="event-logs" element={<EventLogs />} />
      
      {/* Event Debugger subpage */}
      <Route path="event-debugger" element={<EventDebugger />} />
      
    </Routes>
  );
};

/**
 * 主要的 Profile Dashboard 组件
 */
const ProfileDashboard: React.FC = () => {
  const {
    loading,
    error,
    hasData,
    isConnected,
    formattedLastUpdated,
    formattedLatency,
    enabledModulesCount,
    refresh,
  } = useProfileData();

  // Loading state
  if (loading && !hasData) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Loading profile data...
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !hasData) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                Failed to load profile data
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
              <button
                onClick={refresh}
                className="mt-2 text-sm bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200 px-3 py-1 rounded hover:bg-red-200 dark:hover:bg-red-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Profile
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Agent and network information
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>

          {/* Refresh Button */}
          <button
            onClick={refresh}
            disabled={loading}
            className={`
              inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600
              rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300
              bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            `}
          >
            <svg
              className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Status Bar */}
      {formattedLastUpdated && (
        <div className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          Last updated: {formattedLastUpdated}
          {formattedLatency && ` • Latency: ${formattedLatency}`}
          {enabledModulesCount > 0 && ` • ${enabledModulesCount} modules enabled`}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Network Information */}
        <NetworkInfoCard />

        {/* Agent Information */}
        <AgentInfoCard />

        {/* Modules Information */}
        <ModulesInfoCard />

        {/* System Settings */}
        <SystemInfoCard />

      </div>

    </div>
  );
};

export default ProfileMainPage;
