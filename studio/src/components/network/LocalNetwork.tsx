import React, { useEffect, useState } from "react";
import { detectLocalNetwork } from "@/services/networkService";
import { NetworkConnection } from "@/types/connection";
import { useAuthStore } from "@/stores/authStore";
import { useNavigate } from "react-router-dom";

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
        No local OpenAgents network detected
      </p>
    </div>
  );
});

const LocalNetworkShow = React.memo(
  ({ localNetwork }: { localNetwork: NetworkConnection }) => {
    const navigate = useNavigate();
    const { host, port } = localNetwork;
    const { handleNetworkSelected } = useAuthStore();

    const handleConnect = () => {
      handleNetworkSelected(localNetwork);
      navigate("/agent-setup");
    };

    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-green-800 dark:text-green-400">
              Local OpenAgents Network
            </h3>
            <p className="text-green-600 dark:text-green-500">
              Running on {host}:{port}
            </p>
          </div>
          <button
            onClick={() => handleConnect()}
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
  const [localNetwork, setLocalNetwork] = useState<NetworkConnection | null>(
    null
  );
  const [isLoadingLocal, setIsLoadingLocal] = useState(true);

  useEffect(() => {
    const checkLocal = async () => {
      setIsLoadingLocal(true);
      try {
        const local = await detectLocalNetwork();
        setLocalNetwork(local);
      } catch (error) {
        console.error("Error detecting local network:", error);
      } finally {
        setIsLoadingLocal(false);
      }
    };

    checkLocal();
  }, []);

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
        Local Network
      </h2>
      {isLoadingLocal ? (
        <LocalNetworkLoading />
      ) : !localNetwork ? (
        <LocalNetworkNotFound />
      ) : (
        <LocalNetworkShow localNetwork={localNetwork} />
      )}
    </div>
  );
};

export default LocalNetwork;
