import React from "react";
import { Routes, Route } from "react-router-dom";

/**
 * 个人资料主页面 - 处理个人资料相关的所有功能
 */
const ProfileMainPage: React.FC = () => {
  return (
    <Routes>
      {/* 默认个人资料视图 */}
      <Route
        index
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Profile
            </h1>
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  Personal Information
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  Personal information management coming soon...
                </p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  Agent Configuration
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  Agent configuration options coming soon...
                </p>
              </div>
            </div>
          </div>
        }
      />

      {/* 个人信息编辑子页面 */}
      <Route
        path="edit"
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Edit Profile
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Profile editing form coming soon...
            </p>
          </div>
        }
      />

      {/* 安全设置子页面 */}
      <Route
        path="security"
        element={
          <div className="p-6">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Security Settings
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Security configuration panel coming soon...
            </p>
          </div>
        }
      />
    </Routes>
  );
};

export default ProfileMainPage;
