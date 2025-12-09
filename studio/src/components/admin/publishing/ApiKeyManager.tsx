/**
 * API Key Manager Component
 * 
 * Manages API key for publishing
 */

import React, { useState } from 'react';

interface ApiKeyManagerProps {
  apiKeyConfigured: boolean;
}

export const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({ apiKeyConfigured }) => {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState('');

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
        API Key Management
      </h2>

      {apiKeyConfigured ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              ● Active
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              API key is configured
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            ⚠️ API key is stored in your network configuration. Keep it secure.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Enter your OpenAgents API key to enable publishing.
          </p>
          
          <div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="oa-xxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => alert('Save functionality to be implemented')}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              disabled={!apiKey}
            >
              Save Key
            </button>
            <a
              href="https://openagents.org/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Get API Key →
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
