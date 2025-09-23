import React, { useEffect } from "react";
import AppRouter from "./router/AppRouter";
import { useNetworkStore } from "@/stores/networkStore";
import { clearAllOpenAgentsData, clearAllOpenAgentsDataForLogout } from "@/utils/cookies";
import { OpenAgentsServiceProvider } from "@/contexts/OpenAgentsServiceContext";

// Main App component - now simplified to just a router container
const App: React.FC = () => {
  const { clearAgentName, clearNetwork } = useNetworkStore();

  // Add debug function to window for troubleshooting
  useEffect(() => {
    // Only clear data in development or when explicitly needed
    // Don't auto-clear on every app start as it breaks the user flow

    (window as any).clearOpenAgentsData = clearAllOpenAgentsData;
    (window as any).clearNetworkData = () => {
      clearNetwork();
      clearAgentName();
      console.log("🧹 Network data cleared");
    };

    (window as any).clearChannelSelection = () => {
      localStorage.removeItem("openagents_thread");
      console.log("🧹 Channel selection cleared - refresh to test first-time behavior");
    };

    (window as any).clearLogoutData = () => {
      clearAllOpenAgentsDataForLogout();
      console.log("🚪 Logout data cleared (theme preserved) - refresh to see clean state");
    };

    console.log(
      "🔧 Debug: Available commands:",
      "\n- clearOpenAgentsData(): Clear ALL data (theme + agent names + session)",
      "\n- clearLogoutData(): Clear session data like logout (preserves theme + agent names)",
      "\n- clearNetworkData(): Clear network and agent data only",
      "\n- clearChannelSelection(): Clear saved channel selection (test first-time behavior)"
    );
  }, [clearNetwork, clearAgentName]);

  return (
    <OpenAgentsServiceProvider>
      <AppRouter />
    </OpenAgentsServiceProvider>
  );
};

export default App;
