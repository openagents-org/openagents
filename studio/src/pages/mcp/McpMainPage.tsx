import React from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import McpView from "@/components/mcp/McpView";

/**
 * MCP main page - Handle all MCP-related features
 */
const McpMainPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Routes>
      {/* Default MCP view */}
      <Route
        index
        element={<McpView />}
      />

      {/* MCP configuration subpage */}
      <Route
        path="config"
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              MCP Configuration
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              MCP configuration panel coming soon...
            </p>
          </div>
        }
      />

      {/* MCP status subpage */}
      <Route
        path="status"
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              MCP Status
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              MCP status monitoring coming soon...
            </p>
          </div>
        }
      />
    </Routes>
  );
};

export default McpMainPage;
