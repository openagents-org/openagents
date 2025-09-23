import React, { useCallback, useMemo } from "react";
import { ConnectionStatusEnum } from "@/types/connection";
import { useNetworkStore } from "@/stores/networkStore";
import useConnectedStatus from "@/hooks/useConnectedStatus";

const ConnectionLoadingPage: React.FC = () => {
  const { connectionStatus } = useConnectedStatus();
  const { agentName } = useNetworkStore();
  const currentStatus = useMemo(
    () => connectionStatus.status,
    [connectionStatus.status]
  );
  const isError = useMemo(
    () => currentStatus === ConnectionStatusEnum.ERROR,
    [currentStatus]
  );
  const onRetry = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">
          Connecting as {agentName || ""}...
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          Status: {currentStatus}
        </p>
        {isError && (
          <div className="mt-4">
            <p className="text-red-600 dark:text-red-400 text-sm mb-2">
              Connection failed. Please try again.
            </p>
            <button
              onClick={() => onRetry()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionLoadingPage;
