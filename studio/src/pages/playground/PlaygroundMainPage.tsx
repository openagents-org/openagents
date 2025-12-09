import React, { useEffect } from "react";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import PlaygroundSidebar from "./PlaygroundSidebar";
import PlaygroundView from "./PlaygroundView";

/**
 * Interactive Playground - Main Page
 *
 * A unified workspace combining:
 * - Real-time chat for discussion
 * - Kanban board for task tracking
 * - Shared artifacts for outputs
 *
 * Designed for research sessions, collaborative work, and interactive demos.
 */
const PlaygroundMainPage: React.FC = () => {
  const { connector, connectionStatus } = useOpenAgents();
  const { setConnection, setAgentId, reset } = usePlaygroundStore();

  // Initialize store with connection
  useEffect(() => {
    if (connector) {
      setConnection(connector);
    }
    if (connectionStatus.agentId) {
      setAgentId(connectionStatus.agentId);
    }

    return () => {
      // Cleanup on unmount
      reset();
    };
  }, [connector, connectionStatus.agentId, setConnection, setAgentId, reset]);

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-700">
        <PlaygroundSidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <PlaygroundView />
      </div>
    </div>
  );
};

export default PlaygroundMainPage;
