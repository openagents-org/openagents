/**
 * Heartbeat Settings Component
 * 
 * Displays and manages heartbeat settings
 */

import React from 'react';
import { PublishingStatus } from '@/services/publishingApi';

interface HeartbeatSettingsProps {
  status: PublishingStatus | null;
  onRefresh: () => void;
}

export const HeartbeatSettings: React.FC<HeartbeatSettingsProps> = ({ status, onRefresh }) => {
  if (!status) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        Heartbeat Settings
      </h2>

      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-700 dark:text-gray-300">Auto-heartbeat:</span>
          <span className={`px-2.5 py-1 rounded text-xs font-medium ${
            status.auto_heartbeat_enabled
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {status.auto_heartbeat_enabled ? '✓ Enabled' : 'Disabled'}
          </span>
        </div>

        {status.last_heartbeat && (
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Last sent:</span>
            <span className="ml-2 text-gray-600 dark:text-gray-400">
              {new Date(status.last_heartbeat).toLocaleString()}
            </span>
          </div>
        )}

        {status.next_heartbeat && (
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Next scheduled:</span>
            <span className="ml-2 text-gray-600 dark:text-gray-400">
              {new Date(status.next_heartbeat).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
