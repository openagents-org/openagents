import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import AdminDashboard from "./AdminDashboard";

// Import pages from profile (to be migrated)
import AgentManagement from "@/pages/profile/AgentManagement";
import NetworkProfile from "@/pages/profile/NetworkProfile";
import AgentGroupsManagement from "@/pages/profile/AgentGroupsManagement";
import EventLogs from "@/pages/profile/EventLogs";
import EventDebugger from "@/pages/profile/EventDebugger";
import ModManagementPage from "@/pages/mod-management/ModManagementPage";
import AddModPage from "@/pages/mod-management/AddModPage";
import NetworkImportExport from "@/pages/profile/NetworkImportExport";
import TransportConfig from "./TransportConfig";
import ConnectionGuide from "./ConnectionGuide";
import NetworkPublishPage from "./NetworkPublish";
import NetworkReadme from "./NetworkReadme";
import ExportedTools from "./ExportedTools";

// Admin-only pages
import LLMLogsMainPage from "@/pages/llmlogs/LLMLogsMainPage";
import ServiceAgentsMainPage from "@/pages/serviceagents/ServiceAgentsMainPage";
import EventsMainPage from "@/pages/events/EventsMainPage";
import DefaultModelsPage from "./DefaultModelsPage";

/**
 * AdminMainPage - Main router for admin pages
 * All admin routes are protected by AdminRouteGuard
 */
const AdminMainPage: React.FC = () => {
  return (
    <AdminRouteGuard>
      <Routes>
        {/* Default redirect to dashboard */}
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        
        {/* Admin Dashboard */}
        <Route path="dashboard" element={<AdminDashboard />} />
        
        {/* Network Management */}
        <Route path="network" element={<NetworkProfile />} />
        <Route path="readme" element={<NetworkReadme />} />
        <Route path="transports" element={<TransportConfig />} />
        <Route path="publish" element={<NetworkPublishPage />} />
        <Route path="import-export" element={<NetworkImportExport />} />
        
        {/* Agent Management */}
        <Route path="agents" element={<AgentManagement />} />
        <Route path="groups" element={<AgentGroupsManagement />} />
        <Route path="service-agents/*" element={<ServiceAgentsMainPage />} />
        <Route path="default-models" element={<DefaultModelsPage />} />
        <Route path="connect" element={<ConnectionGuide />} />

        {/* Network as Service */}
        <Route path="exported-tools" element={<ExportedTools />} />

        {/* Modules */}
        <Route path="mods" element={<ModManagementPage />} />
        <Route path="mods/add" element={<AddModPage />} />

        {/* Monitoring */}
        <Route path="events" element={<EventLogs />} />
        <Route path="event-explorer/*" element={<EventsMainPage />} />
        <Route path="llm-logs/*" element={<LLMLogsMainPage />} />
        <Route path="debugger" element={<EventDebugger />} />
        <Route path="event-explorer/*" element={<EventsMainPage />} />
      </Routes>
    </AdminRouteGuard>
  );
};

export default AdminMainPage;

