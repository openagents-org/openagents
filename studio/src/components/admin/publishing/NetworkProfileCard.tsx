/**
 * Network Profile Card Component
 * 
 * Displays the network profile information
 */

import React from 'react';
import { PublishingStatus } from '@/services/publishingApi';

interface NetworkProfileCardProps {
  status: PublishingStatus | null;
  onEdit: () => void;
}

export const NetworkProfileCard: React.FC<NetworkProfileCardProps> = ({ status, onEdit }) => {
  if (!status) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Network Profile
        </h2>
        <button
          onClick={onEdit}
          className="px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          Edit
        </button>
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <span className="font-medium text-gray-700 dark:text-gray-300">Network ID:</span>
          <span className="ml-2 text-gray-900 dark:text-gray-100">{status.network_id || 'Not set'}</span>
        </div>

        <div>
          <span className="font-medium text-gray-700 dark:text-gray-300">Description:</span>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Network profile information will be shown here once configured.
          </p>
        </div>
      </div>
    </div>
  );
};
