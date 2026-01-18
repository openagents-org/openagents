import React from "react"
import { useTranslation } from "react-i18next"
import { useThemeStore } from "@/stores/themeStore"
import { profileSelectors } from "@/stores/profileStore"

const SystemInfoCard: React.FC = () => {
  const { t } = useTranslation("profile")
  const { theme, toggleTheme } = useThemeStore()
  const lastUpdated = profileSelectors.useLastUpdated()
  const healthData = profileSelectors.useHealthData()

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("dashboard.system.title")}
        </h3>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-blue-500 rounded-full" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t("dashboard.system.system")}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Theme Settings */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("dashboard.system.appearance")}
          </h4>
          <div className="bg-gray-50 dark:bg-zinc-900 rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="text-gray-600 dark:text-gray-400">
                  {theme === "dark" ? (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                      />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t("dashboard.system.theme")}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {theme === "dark"
                      ? t("dashboard.system.darkMode")
                      : t("dashboard.system.lightMode")}
                  </div>
                </div>
              </div>
              <button
                onClick={toggleTheme}
                className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 dark:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    theme === "dark" ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* System Information */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("dashboard.system.info")}
          </h4>
          <div className="bg-gray-50 dark:bg-zinc-900 rounded-md p-3">
            <div className="grid grid-cols-1 gap-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("dashboard.system.platform")}:
                </span>
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  OpenAgents Studio
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("dashboard.system.version")}:
                </span>
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  1.0.0
                </span>
              </div>
              {lastUpdated && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t("dashboard.system.lastSync")}:
                  </span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">
                    {lastUpdated.toLocaleString()}
                  </span>
                </div>
              )}
              {healthData?.data?.network_id && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t("dashboard.system.networkId")}:
                  </span>
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                    {healthData.data.network_id.slice(0, 8)}...
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        {/* <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Quick Actions
          </h4>
          <div className="grid grid-cols-1 gap-2">
            <Link
              to="/profile/edit"
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  Edit Profile
                </span>
              </div>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>

            <Link
              to="/profile/security"
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  Security Settings
                </span>
              </div>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div> */}

        {/* Status Indicators */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("dashboard.system.status")}
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-gray-50 dark:bg-zinc-900 rounded-md">
              <div className="text-green-500 mb-1">
                <svg
                  className="w-5 h-5 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t("dashboard.system.operational")}
              </div>
            </div>

            <div className="text-center p-2 bg-gray-50 dark:bg-zinc-900 rounded-md">
              <div className="text-blue-500 mb-1">
                <svg
                  className="w-5 h-5 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t("dashboard.system.performance")}
              </div>
            </div>

            <div className="text-center p-2 bg-gray-50 dark:bg-zinc-900 rounded-md">
              <div className="text-purple-500 mb-1">
                <svg
                  className="w-5 h-5 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t("dashboard.system.secure")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SystemInfoCard
