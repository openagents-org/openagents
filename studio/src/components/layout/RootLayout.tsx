import React, { ReactNode, useContext } from "react";
import ModSidebar from "./ModSidebar";
import Sidebar from "./Sidebar";
import ConnectionLoadingOverlay from "./ConnectionLoadingOverlay";
import {
  OpenAgentsProvider,
  OpenAgentsContext,
} from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { Navigate, useLocation } from "react-router-dom";

interface RootLayoutProps {
  children: ReactNode;
}

// Conditionally rendered OpenAgents Provider wrapper
const ConditionalOpenAgentsProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { selectedNetwork, agentName } = useAuthStore();

  // Only initialize OpenAgentsProvider after basic setup is complete
  if (selectedNetwork && agentName) {
    console.log("🚀 RootLayout: Initializing OpenAgentsProvider", {
      network:
        selectedNetwork?.networkInfo?.name ||
        `${selectedNetwork?.host}:${selectedNetwork?.port}`,
      agentName,
    });
    return <OpenAgentsProvider>{children}</OpenAgentsProvider>;
  }

  return <Navigate to="/network-selection" />;
};

/**
 * Root layout component - responsible for overall layout structure
 * Contains: left module navigation + middle content area (sidebar + main content)
 *
 * Now also responsible for conditionally rendering OpenAgentsProvider:
 * - Only initializes OpenAgentsProvider after user completes network selection and agent setup
 * - This ensures all pages using RootLayout can access OpenAgents context
 */
const RootLayout: React.FC<RootLayoutProps> = ({ children }) => {
  return (
    <ConditionalOpenAgentsProvider>
      <RootLayoutContent>{children}</RootLayoutContent>
    </ConditionalOpenAgentsProvider>
  );
};

// Actual layout content component
const RootLayoutContent: React.FC<RootLayoutProps> = ({ children }) => {
  const context = useContext(OpenAgentsContext);
  const isConnected = context?.isConnected || false;
  const location = useLocation();

  // Determine if current route should hide the sidebar
  const shouldHideSidebar = location.pathname.startsWith("/agentworld");

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Connection status overlay - only shown when OpenAgentsProvider exists but not connected */}
      {context && !isConnected && <ConnectionLoadingOverlay />}

      {context && isConnected && (
        <>
          {/* Left module navigation bar */}
          <ModSidebar />

          {/* Middle content area: sidebar + main content */}
          <div className="flex-1 flex overflow-hidden">
            {/* Feature sidebar - now self-managed, automatically displays corresponding content based on route */}
            {!shouldHideSidebar && <Sidebar />}

            {/* Main content area */}
            <main className="flex-1 flex flex-col overflow-hidden m-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white via-blue-50 to-purple-50 dark:bg-gray-800">
              {children}
            </main>
          </div>
        </>
      )}
    </div>
  );
};

export default RootLayout;
