import React from "react";
import { Routes, Route } from "react-router-dom";
import ServiceAgentList from "./components/ServiceAgentList";
import ServiceAgentDetail from "./components/ServiceAgentDetail";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * Service Agents Management Main Page
 * Page for managing service agents (admin only)
 */
const ServiceAgentsMainPage: React.FC = () => {
  const { isAdmin, isLoading } = useIsAdmin();

  // Show loading state while checking admin status
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 dark:text-gray-400 mt-3">
            Checking permissions...
          </p>
        </div>
      </div>
    );
  }

  // Show access denied for non-admin users
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Access Denied
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Service Agents Management is only available to administrators.
            Please contact your network administrator if you need access.
          </p>
        </div>
      </div>
    );
  }

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

