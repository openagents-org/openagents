import React from "react"
import { useTranslation } from "react-i18next"
import { profileSelectors } from "@/stores/profileStore"

const ModulesInfoCard: React.FC = () => {
  const { t } = useTranslation("profile")
  const modulesInfo = profileSelectors.useModulesInfo()
  const enabledModulesCount = profileSelectors.useEnabledModulesCount()

  const totalModules = modulesInfo?.length || 0

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("dashboard.modules.title")}
        </h3>
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {t("dashboard.modules.count_enabled", {
              count: enabledModulesCount,
              total: totalModules,
            })}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Modules Summary */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("dashboard.modules.summary")}
          </h4>
          <div className="bg-gray-50 dark:bg-zinc-900 rounded-md p-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {enabledModulesCount}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("dashboard.modules.enabled")}
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                  {totalModules - enabledModulesCount}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t("dashboard.modules.disabled")}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modules List */}
        {modulesInfo && modulesInfo.length > 0 ? (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("dashboard.modules.available")}
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {modulesInfo.map((module, index) => (
                <div
                  key={module.name || index}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-900 rounded-md"
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        module.enabled
                          ? "bg-green-500"
                          : "bg-gray-400 dark:bg-gray-500"
                      }`}
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {module.name || "Unknown Module"}
                      </div>
                    </div>
                  </div>
                  {/* <div className="flex items-center space-x-2">
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        module.enabled
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {module.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div> */}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="text-gray-400 dark:text-gray-500 mb-2">
              <svg
                className="w-12 h-12 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("dashboard.modules.noModules")}
            </p>
          </div>
        )}

        {/* Progress Bar */}
        {totalModules > 0 && (
          <div>
            <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
              <span>{t("dashboard.modules.activation")}</span>
              <span>
                {Math.round((enabledModulesCount / totalModules) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(enabledModulesCount / totalModules) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ModulesInfoCard
