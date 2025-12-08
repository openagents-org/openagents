/**
 * Network Configuration step - Display current network settings
 */

import React from 'react';

interface NetworkConfigStepProps {
  networkData: {
    name: string;
    description: string;
    transports: {
      http?: { enabled: boolean; port: number };
      grpc?: { enabled: boolean; port: number };
    };
    mods: string[];
    studio_enabled: boolean;
  };
  onBack: () => void;
  onContinue: () => void;
}

const NetworkConfigStep: React.FC<NetworkConfigStepProps> = ({
  networkData,
  onBack,
  onContinue,
}) => {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Network Configuration
        </h2>
        <p className="text-lg text-gray-600">
          Here's an overview of your network settings
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="space-y-6">
          {/* Network Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Network Name
            </label>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-gray-900 font-medium">{networkData.name}</p>
            </div>
          </div>

          {/* Description */}
          {networkData.description && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Description
              </label>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <p className="text-gray-700">{networkData.description}</p>
              </div>
            </div>
          )}

          {/* Transports */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Active Transports
            </label>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="space-y-2">
                {networkData.transports.http?.enabled && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      <span className="font-medium text-gray-900">HTTP Transport</span>
                    </div>
                    <span className="text-gray-600">
                      localhost:{networkData.transports.http.port}
                    </span>
                  </div>
                )}
                {networkData.transports.grpc?.enabled && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      <span className="font-medium text-gray-900">gRPC Transport</span>
                    </div>
                    <span className="text-gray-600">
                      localhost:{networkData.transports.grpc.port}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Enabled Mods */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Enabled Mods
            </label>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              {networkData.mods.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {networkData.mods.map((mod) => (
                    <span
                      key={mod}
                      className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium"
                    >
                      <svg
                        className="w-4 h-4 mr-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {mod}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 italic">No mods enabled</p>
              )}
            </div>
          </div>

          {/* Studio Status */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Studio Status
            </label>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="flex items-center">
                <div
                  className={`w-2 h-2 rounded-full mr-3 ${
                    networkData.studio_enabled ? 'bg-green-500' : 'bg-gray-400'
                  }`}
                ></div>
                <span className="font-medium text-gray-900">
                  {networkData.studio_enabled
                    ? 'Enabled at /studio'
                    : 'Not enabled'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="px-6 py-2 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
};

export default NetworkConfigStep;
