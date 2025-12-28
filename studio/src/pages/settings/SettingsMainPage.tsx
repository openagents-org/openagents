import React from "react";
import { Routes, Route } from "react-router-dom";
import { useTranslation } from "react-i18next";

/**
 * Settings main page - handles all settings-related features
 */
const SettingsMainPage: React.FC = () => {
  const { t } = useTranslation('profile');
  
  return (
    <div className="h-full dark:bg-gray-800">
    <Routes>
      {/* Default settings view */}
      <Route
        index
        element={
          <div className="p-6 dark:bg-gray-800 h-full">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              {t('settings.title')}
            </h1>
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  {t('settings.generalSettings')}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('settings.generalDescription')}
                </p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
                  {t('settings.networkSettings')}
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('settings.networkDescription')}
                </p>
              </div>
            </div>
          </div>
        }
      />

      {/* Network settings subpage */}
      <Route
        path="network"
        element={
          <div className="p-6 h-full dark:bg-gray-800">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              {t('settings.networkSettings')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('settings.networkConfigPanel')}
            </p>
          </div>
        }
      />

      {/* Theme settings subpage */}
      <Route
        path="theme"
        element={
          <div className="p-6 h-full dark:bg-gray-800">
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              {t('settings.themeSettings')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('settings.themeConfigPanel')}
            </p>
          </div>
        }
      />
    </Routes>
    </div>
  );
};

export default SettingsMainPage;
