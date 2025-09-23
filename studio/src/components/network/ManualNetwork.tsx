import React, { useState, useEffect, useMemo } from "react";
import {
  saveManualConnection,
  getSavedManualConnection,
  clearSavedManualConnection,
  getSavedAgentNameForNetwork,
} from "@/utils/cookies";
import { useNetworkStore } from "@/stores/networkStore";
import { ManualNetworkConnection } from "@/services/networkService";
import { ConnectionStatusEnum } from "@/types/connection";

export default function ManualNetwork() {
  const { handleNetworkSelected } = useNetworkStore();
  const [showManualConnect, setShowManualConnect] = useState(false);
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState("8571");
  const [isLoadingConnection, setIsLoadingConnection] = useState(false);
  const [savedConnection, setSavedConnection] = useState<{
    host: string;
    port: string;
  } | null>(null);
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null);

  // Load saved connection and detect local network on component mount
  useEffect(() => {
    // Load saved manual connection
    loadSavedInfo();
  }, []);

  const loadSavedInfo = () => {
    const saved = getSavedManualConnection();
    if (!saved) return;
    setSavedConnection(saved);
    setManualHost(saved.host);
    setManualPort(saved.port);

    // Also load saved agent name for this network
    const agentName = getSavedAgentNameForNetwork(saved.host, saved.port);
    setSavedAgentName(agentName);
  };

  const handleConnect = async (
    isQuickConnect: boolean,
    {
      host,
      port,
    }: {
      host: string;
      port: string;
    }
  ) => {
    setIsLoadingConnection(true);
    try {
      const connection = await ManualNetworkConnection(host, parseInt(port));
      if (connection.status === ConnectionStatusEnum.CONNECTED) {
        if (!isQuickConnect) {
          // Save successful connection to cookies
          saveManualConnection(host, port);
          setSavedConnection({ host, port });
        }
        handleNetworkSelected(connection);
      } else {
        alert(
          "Failed to connect to the network. Please check the host and port."
        );
      }
    } catch (error) {
      alert("Error connecting to network: " + error);
    } finally {
      setIsLoadingConnection(false);
    }
  };

  const handleManualConnect = async () => {
    handleConnect(false, {
      host: manualHost,
      port: manualPort,
    });
  };

  const handleQuickConnect = async () => {
    if (!savedConnection) return;
    handleConnect(true, savedConnection);
  };

  const handleClearSaved = () => {
    clearSavedManualConnection();
    setSavedConnection(null);
    setManualHost("");
    setManualPort("8571");
    setSavedAgentName(null);
  };

  const manualConnectButtonDisabled = useMemo(() => {
    return !manualHost || !manualPort || isLoadingConnection;
  }, [manualHost, manualPort, isLoadingConnection]);

  const ManualNetworkHeader = React.memo(
    ({
      showManualConnect,
      onToggle,
    }: {
      showManualConnect: boolean;
      onToggle: () => void;
    }) => (
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">
          Manual Connection
        </h2>
        <button
          onClick={onToggle}
          className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-medium"
        >
          {showManualConnect ? "Hide" : "Show"} Manual Connect
        </button>
      </div>
    )
  );

  return (
    <div className="mb-8">
      <ManualNetworkHeader
        showManualConnect={showManualConnect}
        onToggle={() => setShowManualConnect(!showManualConnect)}
      />

      {/* Quick Connect to Saved Server */}
      {savedConnection && !showManualConnect && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-400">
                Last Connected Server
              </h3>
              <p className="text-blue-600 dark:text-blue-500">
                {savedConnection.host}:{savedConnection.port}
              </p>
              {savedAgentName && (
                <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                  👤 Last used as: <strong>{savedAgentName}</strong>
                </p>
              )}
              <p className="text-sm text-blue-600 dark:text-blue-500 mt-1">
                Cached from previous successful connection
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleQuickConnect}
                disabled={isLoadingConnection}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                {isLoadingConnection ? "Connecting..." : "Quick Connect"}
              </button>
              <button
                onClick={handleClearSaved}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 px-3 py-2 rounded-lg font-medium transition-colors"
                title="Clear saved connection"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {showManualConnect && (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
          {savedConnection && (
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                💡 <strong>Using saved connection:</strong>{" "}
                {savedConnection.host}:{savedConnection.port}
                <button
                  onClick={handleClearSaved}
                  className="ml-2 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                  title="Clear and start fresh"
                >
                  (clear)
                </button>
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Host
              </label>
              <input
                type="text"
                value={manualHost}
                onChange={(e) => setManualHost(e.target.value)}
                placeholder="localhost or IP address"
                className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Port
              </label>
              <input
                type="number"
                value={manualPort}
                onChange={(e) => setManualPort(e.target.value)}
                placeholder="8571"
                className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={handleManualConnect}
              disabled={manualConnectButtonDisabled}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              {isLoadingConnection ? "Testing Connection..." : "Connect"}
            </button>

            {savedConnection && (
              <button
                onClick={() => {
                  setManualHost(savedConnection.host);
                  setManualPort(savedConnection.port);
                }}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Reset to Saved
              </button>
            )}
          </div>

          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            💾 Successful connections will be automatically saved for quick
            access
          </p>
        </div>
      )}
    </div>
  );
}
