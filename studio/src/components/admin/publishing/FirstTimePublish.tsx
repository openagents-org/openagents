/**
 * First Time Publish Component
 * 
 * Wizard for first-time network publishing
 */

import React, { useState } from 'react';
import { NetworkProfile } from '@/services/publishingApi';

interface FirstTimePublishProps {
  onPublish: (profile?: NetworkProfile) => Promise<boolean>;
  apiKeyConfigured: boolean;
}

export const FirstTimePublish: React.FC<FirstTimePublishProps> = ({ onPublish, apiKeyConfigured }) => {
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      await onPublish();
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
      <div className="text-center mb-8">
        <div className="text-5xl mb-4">🚀</div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Publish Your Network
        </h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          Make your network discoverable to the OpenAgents community. Published networks appear in
          the directory and can be connected via <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">openagents://your-network-id</code>
        </p>
      </div>

      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Step 1: API Key */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Step 1: API Key
          </h3>
          
          {apiKeyConfigured ? (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <span className="text-xl">✓</span>
              <span>API key is configured</span>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                You need an API key from openagents.org to publish your network.
              </p>
              <a
                href="https://openagents.org/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Get API Key →
              </a>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                Configure the API key in your network.yaml file under <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">network.publishing.api_key</code>
              </p>
            </div>
          )}
        </div>

        {/* Step 2: Network Profile */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Step 2: Network Profile
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your network profile is configured in network.yaml under the <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">network_profile</code> section.
          </p>
        </div>

        {/* Step 3: Publish */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Step 3: Publish
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Click the button below to publish your network to the discovery registry.
          </p>
          <button
            onClick={handlePublish}
            disabled={!apiKeyConfigured || isPublishing}
            className="w-full px-6 py-3 text-base font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isPublishing ? 'Publishing...' : 'Publish Network'}
          </button>
        </div>
      </div>
    </div>
  );
};
