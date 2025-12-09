/**
 * Publishing Status Component
 * 
 * Displays the current publishing status and statistics
 */

import React from 'react';
import { PublishingStatus as Status } from '@/services/publishingApi';

interface PublishingStatusProps {
  status: Status | null;
  onUnpublish: () => void;
  onSendHeartbeat: () => void;
}

export const PublishingStatus: React.FC<PublishingStatusProps> = ({
  status,
  onUnpublish,
  onSendHeartbeat,
}) => {
  if (!status) return null;

  const isOnline = status.status === 'online';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Publishing Status
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onSendHeartbeat}
            className="px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
          >
            💓 Send Heartbeat
          </button>
          <button
            onClick={onUnpublish}
            className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            Unpublish Network
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Status Indicator */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Status:</span>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className={`font-medium ${isOnline ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}>
              {isOnline ? 'Published (Online)' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Network ID */}
        {status.network_id && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Network ID:</span>
            <span className="text-sm text-gray-900 dark:text-gray-100 font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
              {status.network_id}
            </span>
          </div>
        )}

        {/* Discovery URL */}
        {status.discovery_url && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Discovery URL:</span>
            <span className="text-sm text-blue-600 dark:text-blue-400 font-mono">
              {status.discovery_url}
            </span>
          </div>
        )}

        {/* Last Heartbeat */}
        {status.last_heartbeat && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Last Heartbeat:</span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {new Date(status.last_heartbeat).toLocaleString()}
            </span>
          </div>
        )}

        {/* Statistics */}
        {status.stats && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {status.stats.views}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Views</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {status.stats.likes}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Likes</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {status.stats.online_agents}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Connected Agents</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
