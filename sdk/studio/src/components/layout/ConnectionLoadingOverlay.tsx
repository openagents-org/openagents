import React, { useCallback, useMemo, useContext } from "react";
import { useTranslation } from "react-i18next";
import {
  ConnectionState,
  OpenAgentsContext,
} from "@/context/OpenAgentsProvider";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { clearAllOpenAgentsDataForLogout } from "@/utils/cookies";
import { useNavigate } from "react-router-dom";

const ConnectionLoadingOverlay: React.FC = () => {
  const { t } = useTranslation('layout');
  const context = useContext(OpenAgentsContext);
  const navigate = useNavigate();
  const { agentName, clearNetwork, clearAgentName } =
    useAuthStore();
  const { clearAllChatData } = useChatStore();

  const currentStatus = useMemo(
    () => context?.connectionStatus.state || ConnectionState.DISCONNECTED,
    [context?.connectionStatus.state]
  );

  const isError = useMemo(
    () => currentStatus === ConnectionState.ERROR,
    [currentStatus]
  );

  const onRetry = useCallback(async () => {
    // if (context?.connect) {
    //   await context.connect();
    // } else {
    window.location.reload();
    // }
  }, []);



  // Logout handler function
  const handleLogout = async () => {
    console.log("🚪 Logout button clicked - showing confirmation dialog");

    try {
      // Clear network state
      clearNetwork();
      clearAgentName();
      console.log("🧹 Network state cleared");

      // Clear chat store data
      clearAllChatData();
      console.log("🧹 Chat store data cleared");

      // Clear all OpenAgents-related data (preserve theme settings)
      clearAllOpenAgentsDataForLogout();

      // Navigate to network selection page
      console.log("🔄 Navigating to network selection");
      navigate("/network-selection", { replace: true });
    } catch (error) {
      console.error("❌ Error during logout:", error);
    }
  };

  return (
    <div className="w-full inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
      <div className="text-center">
        {!isError && <><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {t('overlay.connecting', { name: agentName || "" })}
          </p></>}
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          {t('overlay.status', { status: currentStatus })}
        </p>
        {isError && (
          <div className="mt-4">
            <p className="text-red-600 dark:text-red-400 text-sm mb-2">
              {t('overlay.failed')}
            </p>
            <div className="flex">
              <button
                onClick={() => onRetry()}
                className="mt-2 px-4 py-2 bg-blue-400 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('overlay.retry')}
              </button>
              <button
                onClick={() => handleLogout()}
                className="ml-6 mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('overlay.backToNetwork')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionLoadingOverlay;
