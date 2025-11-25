import React, { useCallback } from "react";
import {
  useOpenAgents,
  ConnectionState,
} from "../../context/OpenAgentsProvider";
import { useAuthStore } from "../../stores/authStore";
import { clearAllOpenAgentsDataForLogout } from "../../utils/cookies";
import { useNavigate } from "react-router-dom";

const ConnectionLoadingOverlay: React.FC = () => {
  const { connectionStatus } = useOpenAgents();
  const navigate = useNavigate();
  const { agentName, clearNetwork, clearAgentName } = useAuthStore();

  const isError = connectionStatus.state === ConnectionState.ERROR;

  const onRetry = useCallback(() => {
    window.location.reload();
  }, []);

  const handleLogout = async () => {
    try {
      clearNetwork();
      clearAgentName();
      clearAllOpenAgentsDataForLogout();
      navigate("/", { replace: true });
    } catch (error) {
      console.error("Error during logout:", error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        {!isError && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">
              Connecting as {agentName || ""}...
            </p>
          </>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          Status: {connectionStatus.state}
        </p>
        {isError && (
          <div className="mt-4">
            <p className="text-red-600 dark:text-red-400 text-sm mb-2">
              Connection failed. Please try again.
            </p>
            {connectionStatus.error && (
              <p className="text-red-500 dark:text-red-400 text-xs mb-2">
                {connectionStatus.error}
              </p>
            )}
            <div className="flex justify-center gap-4">
              <button
                onClick={onRetry}
                className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={handleLogout}
                className="mt-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Select Network
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionLoadingOverlay;

