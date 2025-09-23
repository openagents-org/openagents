import React from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import McpView from "@/components/mcp/McpView";

/**
 * MCP 主页面 - 处理 MCP 相关的所有功能
 */
const McpMainPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Routes>
      {/* 默认 MCP 视图 */}
      <Route
        index
        element={<McpView onBackClick={() => navigate("/chat")} />}
      />

      {/* MCP 配置子页面 */}
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

      {/* MCP 状态子页面 */}
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
