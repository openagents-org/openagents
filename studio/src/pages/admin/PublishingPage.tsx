/**
 * Network Publishing Page
 * 
 * Main page for managing network publishing to the OpenAgents discovery registry
 */

import React, { useState } from 'react';
import { usePublishing } from '@/hooks/usePublishing';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { PublishingStatus } from '@/components/admin/publishing/PublishingStatus';
import { NetworkProfileCard } from '@/components/admin/publishing/NetworkProfileCard';
import { ApiKeyManager } from '@/components/admin/publishing/ApiKeyManager';
import { HeartbeatSettings } from '@/components/admin/publishing/HeartbeatSettings';
import { FirstTimePublish } from '@/components/admin/publishing/FirstTimePublish';
import { ProfileEditorModal } from '@/components/admin/publishing/ProfileEditorModal';
import { NetworkProfile } from '@/services/publishingApi';

const PublishingPage: React.FC = () => {
  const { isAdmin, isLoading: isLoadingAdmin } = useIsAdmin();
  const { status, isLoading, publish, unpublish, updateProfile, sendHeartbeat, refresh } = usePublishing();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // Check if user is admin
  if (isLoadingAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <h2 className="text-2xl font-bold text-red-700 dark:text-red-400 mb-2">Access Denied</h2>
          <p className="text-red-600 dark:text-red-500">
            Only administrators can access the network publishing page.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading publishing status...</p>
        </div>
      </div>
    );
  }

  const handleEditProfile = () => {
    setIsEditorOpen(true);
  };

  const handleSaveProfile = async (profile: NetworkProfile) => {
    const success = await updateProfile(profile);
    if (success) {
      setIsEditorOpen(false);
    }
  };

  const handleUnpublish = async () => {
    if (status?.network_id && window.confirm('Are you sure you want to unpublish this network?')) {
      await unpublish(status.network_id);
    }
  };

  // Show first-time publish flow if not published
  const showFirstTimeFlow = !status?.is_published;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Network Publishing
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage your network's presence in the OpenAgents discovery registry
            </p>
          </div>
          {status?.is_published && (
            <button
              onClick={refresh}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              🔄 Refresh
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {showFirstTimeFlow ? (
            <FirstTimePublish 
              onPublish={publish}
              apiKeyConfigured={status?.api_key_configured || false}
            />
          ) : (
            <>
              {/* Publishing Status */}
              <PublishingStatus
                status={status}
                onUnpublish={handleUnpublish}
                onSendHeartbeat={sendHeartbeat}
              />

              {/* Network Profile */}
              <NetworkProfileCard
                status={status}
                onEdit={handleEditProfile}
              />

              {/* API Key Management */}
              <ApiKeyManager
                apiKeyConfigured={status?.api_key_configured || false}
              />

              {/* Heartbeat Settings */}
              <HeartbeatSettings
                status={status}
                onRefresh={refresh}
              />
            </>
          )}
        </div>
      </div>

      {/* Profile Editor Modal */}
      {isEditorOpen && status && (
        <ProfileEditorModal
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          onSave={handleSaveProfile}
          // TODO: Pass actual profile data from network.yaml or API
          // Currently null means creating a new profile
          currentProfile={null}
          networkId={status.network_id || ''}
        />
      )}
    </div>
  );
};

export default PublishingPage;
