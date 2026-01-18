import React, { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { profileSelectors } from "@/stores/profileStore"
import { useAuthStore } from "@/stores/authStore"

const NetworkInfoCard: React.FC = () => {
  const { t } = useTranslation("profile")
  const { selectedNetwork } = useAuthStore()
  const networkInfo = profileSelectors.useNetworkInfo()
  const isOnline = profileSelectors.useIsOnline()
  const connectionLatency = profileSelectors.useConnectionLatency()
  const healthData = profileSelectors.useHealthData()

  // Format uptime_seconds to 3 decimal places
  const uptimeDisplay = useMemo(() => {
    const uptimeSeconds = (healthData as any)?.uptime_seconds
    if (uptimeSeconds !== undefined && uptimeSeconds !== null) {
      return `${Number(uptimeSeconds).toFixed(3)}s`
    }
    return "N/A"
  }, [healthData])

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("dashboard.network.title")}
        </h3>
        <div className="flex items-center space-x-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isOnline ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {isOnline
              ? t("dashboard.network.online")
              : t("dashboard.network.offline")}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Network Connection */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("dashboard.network.connection")}
          </h4>
          <div className="bg-gray-50 dark:bg-zinc-900 rounded-md p-3">
            <div className="grid grid-cols-1 gap-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("dashboard.network.host")}:
                </span>
                <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                  {selectedNetwork?.host || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t("dashboard.network.port")}:
                </span>
                <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                  {selectedNetwork?.port || "N/A"}
                </span>
              </div>
              {connectionLatency && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t("dashboard.network.latency")}:
                  </span>
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                    {connectionLatency}ms
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Network Details */}
        {networkInfo && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("dashboard.network.details")}
            </h4>
            <div className="bg-gray-50 dark:bg-zinc-900 rounded-md p-3">
              <div className="grid grid-cols-1 gap-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t("dashboard.network.id")}:
                  </span>
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                    {networkInfo.networkId || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t("dashboard.network.name")}:
                  </span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">
                    {networkInfo.networkName || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t("dashboard.network.status")}:
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      networkInfo.isRunning
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {networkInfo.isRunning
                      ? t("dashboard.network.running")
                      : t("dashboard.network.stopped")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t("dashboard.network.health")}:
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      networkInfo.status === "healthy"
                        ? "text-green-600 dark:text-green-400"
                        : "text-yellow-600 dark:text-yellow-400"
                    }`}
                  >
                    {networkInfo.status || t("dashboard.network.unknown")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Uptime:
                  </span>
                  <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                    {uptimeDisplay}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No Data State */}
        {!networkInfo && !selectedNetwork && (
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
                  d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("dashboard.network.noConnection")}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default NetworkInfoCard
