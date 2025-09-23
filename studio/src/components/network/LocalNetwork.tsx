import React from "react";
import { NetworkConnection } from "@/types/connection";
import useLocalNetwork from "@/hooks/useLocalNetwork";
import { useNetworkStore } from "@/stores/networkStore";

const LocalNetworkLoading = React.memo(() => {
  return (
    <div className="flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-700 rounded-lg">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      <span className="ml-3 text-gray-600 dark:text-gray-400">
        Detecting local network...
      </span>
    </div>
  );
});

const LocalNetworkNotFound = React.memo(() => {
  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
      <p className="text-yellow-800 dark:text-yellow-400">
        No local OpenAgents network detected on common ports (8570-8575)
      </p>
    </div>
  );
});

const LocalNetworkShow = React.memo(
  ({ localNetwork }: { localNetwork: NetworkConnection }) => {
    const { host, port, latency, networkInfo } = localNetwork;
    const { name = "Local OpenAgents Network", workspace_path } =
      networkInfo || {};
    const { handleNetworkSelected } = useNetworkStore();
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-green-800 dark:text-green-400">
              {name}
            </h3>
            <p className="text-green-600 dark:text-green-500">
              Running on {host}:{port}
            </p>
            {workspace_path && (
              <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                📁 Workspace:{" "}
                <span className="font-mono text-xs bg-green-100 dark:bg-green-800 px-2 py-1 rounded">
                  {workspace_path}
                </span>
              </p>
            )}
            {latency && (
              <p className="text-sm text-green-600 dark:text-green-500">
                Latency: {latency}ms
              </p>
            )}
          </div>
          <button
            onClick={() => handleNetworkSelected(localNetwork)}
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }
);

const LocalNetwork: React.FC = () => {
  const { localNetwork, isLoadingLocal } = useLocalNetwork();
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
        Local Network
      </h2>
      {isLoadingLocal ? (
        <LocalNetworkLoading />
      ) : localNetwork ? (
        <LocalNetworkShow localNetwork={localNetwork} />
      ) : (
        <LocalNetworkNotFound />
      )}
    </div>
  );
};

export default LocalNetwork;
