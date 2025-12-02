import React, { useContext, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";
import { useLLMLogStore } from "@/stores/llmLogStore";
import LLMLogsView from "@/components/llmlogs/LLMLogsView";

const LLMLogsMainPage: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;

  const { setConnection, setAgentId, loadLogs, loadStats } = useLLMLogStore();

  // Setup connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
      setAgentId(openAgentsService.getAgentId ? openAgentsService.getAgentId() : null);
    }
  }, [openAgentsService, setConnection, setAgentId]);

  // Load logs when connected
  useEffect(() => {
    if (openAgentsService && isConnected) {
      console.log("LLMLogsMainPage: Connection ready, loading logs");
      loadLogs();
      loadStats();
    }
  }, [openAgentsService, isConnected, loadLogs, loadStats]);

  return (
    <Routes>
      <Route index element={<LLMLogsView />} />
    </Routes>
  );
};

export default LLMLogsMainPage;

