import React, { ReactNode } from "react";
import Sidebar from "./Sidebar";
import ConnectionLoadingOverlay from "./ConnectionLoadingOverlay";
import {
  OpenAgentsProvider,
  useOpenAgents,
} from "../../context/OpenAgentsProvider";
import { useAuthStore } from "../../stores/authStore";
import { Navigate } from "react-router-dom";

interface RootLayoutProps {
  children: ReactNode;
}

const ConditionalProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { selectedNetwork, agentName } = useAuthStore();

  if (selectedNetwork && agentName) {
    return <OpenAgentsProvider>{children}</OpenAgentsProvider>;
  }

  return <Navigate to="/" replace />;
};

const RootLayoutContent: React.FC<RootLayoutProps> = ({ children }) => {
  const { isConnected } = useOpenAgents();

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {!isConnected && <ConnectionLoadingOverlay />}

      {isConnected && (
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
            {children}
          </main>
        </div>
      )}
    </div>
  );
};

const RootLayout: React.FC<RootLayoutProps> = ({ children }) => {
  return (
    <ConditionalProvider>
      <RootLayoutContent>{children}</RootLayoutContent>
    </ConditionalProvider>
  );
};

export default RootLayout;

