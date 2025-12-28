import React from "react";
import { useTranslation } from "react-i18next";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useProfileData } from "./hooks/useProfileData";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/layout/ui/button";

// Components (to be created)
import NetworkInfoCard from "./components/NetworkInfoCard";
import ModulesInfoCard from "./components/ModulesInfoCard";
import AgentInfoCard from "./components/AgentInfoCard";
import SystemInfoCard from "./components/SystemInfoCard";
import AgentManagement from "./AgentManagement";
import NetworkProfile from "./NetworkProfile";
import AgentGroupsManagement from "./AgentGroupsManagement";
import EventLogs from "./EventLogs";
import EventDebugger from "./EventDebugger";
import ModManagementPage from "../mod-management/ModManagementPage";
// NetworkImportExport component available for future use

/**
 * Profile main page - handles all profile-related features
 */
const ProfileMainPage: React.FC = () => {
  const { t } = useTranslation('profile');
  return (
    <div className="h-full dark:bg-gray-800">
    <Routes>

      {/* Default profile view */}
      <Route index element={<ProfileDashboard />} />

      {/* Profile edit subpage */}
      <Route
        path="edit"
        element={
          <div className="p-6 dark:bg-gray-800 h-full">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              {t('profile.editProfile')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('comingSoon.profileEditingForm')}
            </p>
          </div>
        }
      />

      {/* Security settings subpage */}
      <Route
        path="security"
        element={
          <div className="p-6 dark:bg-gray-800 h-full">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              {t('profile.securitySettings')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('comingSoon.securityConfigPanel')}
            </p>
          </div>
        }
      />

      {/* Agent Management subpage - Admin only */}
      <Route path="agent-management" element={<AgentManagement />} />
      <Route path="network-profile" element={<NetworkProfile />} />
      <Route path="agent-groups" element={<AgentGroupsManagement />} />
      <Route path="mod-management" element={<ModManagementPage />} />


      {/* Event Logs subpage */}
      <Route path="event-logs" element={<EventLogs />} />

      {/* Event Debugger subpage */}
      <Route path="event-debugger" element={<EventDebugger />} />

    </Routes>
    </div>
  );
};

/**
 * Main Profile Dashboard component
 */
const ProfileDashboard: React.FC = () => {
  const { t } = useTranslation('profile');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isAdmin: _isAdmin } = useIsAdmin();
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
            {t('comingSoon.loadingProfileData')}
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
                {t('comingSoon.failedToLoadProfileData')}
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
              <Button
                onClick={refresh}
                variant="destructive"
                size="sm"
                className="mt-2"
              >
                {t('comingSoon.tryAgain')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="p-6 dark:bg-gray-800 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('profile.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t('profile.subtitle')}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"
                }`}
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isConnected ? t('profile.status.connected') : t('profile.status.disconnected')}
            </span>
          </div>

          {/* Refresh Button */}
          <Button
            onClick={refresh}
            disabled={loading}
            variant="outline"
            size="sm"
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
            {loading ? t('profile.refreshing') : t('profile.refresh')}
          </Button>
        </div>
      </div>

      {/* Status Bar */}
      {formattedLastUpdated && (
        <div className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          {t('profile.lastUpdated')}: {formattedLastUpdated}
          {formattedLatency && ` • ${t('profile.latency')}: ${formattedLatency}`}
          {enabledModulesCount > 0 && ` • ${t('profile.modulesEnabled', { count: enabledModulesCount })}`}
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
