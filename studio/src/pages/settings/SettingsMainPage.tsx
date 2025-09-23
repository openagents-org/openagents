import React from "react";
import { Routes, Route } from "react-router-dom";

/**
 * 设置主页面 - 处理设置相关的所有功能
 */
const SettingsMainPage: React.FC = () => {
  return (
    <Routes>
      {/* 默认设置视图 */}
      <Route
        index
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Settings
            </h1>
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  General Settings
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  General configuration options coming soon...
                </p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  Network Settings
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  Network configuration options coming soon...
                </p>
              </div>
            </div>
          </div>
        }
      />

      {/* 网络设置子页面 */}
      <Route
        path="network"
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Network Settings
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Network configuration panel coming soon...
            </p>
          </div>
        }
      />

      {/* 主题设置子页面 */}
      <Route
        path="theme"
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Theme Settings
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Theme configuration panel coming soon...
            </p>
          </div>
        }
      />
    </Routes>
  );
};

export default SettingsMainPage;
