import React from "react";
import { Routes, Route } from "react-router-dom";
import { useTranslation } from "react-i18next";
import McpView from "@/components/mcp/McpView";

/**
 * MCP main page - Handle all MCP-related features
 */
const McpMainPage: React.FC = () => {
  const { t } = useTranslation("mcp");

  return (
    <div className="h-full dark:bg-gray-800">
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
            <div className="p-6 h-full dark:bg-gray-800">
              <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
                {t("pages.config.title")}
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {t("pages.config.description")}
              </p>
            </div>
          }
        />

        {/* MCP status subpage */}
        <Route
          path="status"
          element={
            <div className="p-6 h-full dark:bg-gray-800">
              <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
                {t("pages.status.title")}
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {t("pages.status.description")}
              </p>
            </div>
          }
        />
      </Routes>
    </div>
  );
};

export default McpMainPage;
