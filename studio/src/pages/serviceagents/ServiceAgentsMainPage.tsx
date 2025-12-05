import React from "react";
import { Routes, Route } from "react-router-dom";
import ServiceAgentList from "./components/ServiceAgentList";
import ServiceAgentDetail from "./components/ServiceAgentDetail";

/**
 * Service Agents Management Main Page
 * Page for managing service agents
 */
const ServiceAgentsMainPage: React.FC = () => {
  return (
    <Routes>
      {/* Default: Service agents list */}
      <Route index element={<ServiceAgentList />} />

      {/* Service agent detail view */}
      <Route path=":agentId" element={<ServiceAgentDetail />} />
    </Routes>
  );
};

export default ServiceAgentsMainPage;

