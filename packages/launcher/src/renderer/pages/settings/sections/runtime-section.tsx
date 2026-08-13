import React from "react"
import { useTranslation } from "react-i18next"
import { ClipboardCopy, FolderOpen, RefreshCw } from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { formatBytes } from "@renderer/lib/format"
import { SettingsCard, Row, InfoRow } from "../components/settings-card"
import type { RuntimeInfo, SystemInfo } from "@renderer/types"
import type { SettingsPaths } from "../use-settings-state"
import type { ToastType } from "@renderer/hooks/useToast"

interface Props {
  runtimeInfo: RuntimeInfo | null
  systemInfo: SystemInfo | null
  paths: SettingsPaths
  launcherVersion: string
  showToast: (msg: string, type?: ToastType) => void
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
}

export function RuntimeSection({
  runtimeInfo,
  systemInfo,
  paths,
  launcherVersion,
  showToast,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const coreUpToDate =
    !!runtimeInfo?.latestVersion &&
    runtimeInfo.coreVersion === runtimeInfo.latestVersion

  const memUsed = systemInfo ? systemInfo.totalMemory - systemInfo.freeMemory : 0
  const memPercent = systemInfo
    ? Math.round((memUsed / systemInfo.totalMemory) * 100)
    : 0

  const copyDiagnostics = async (): Promise<void> => {
    const lines = [
      `Launcher: ${launcherVersion}`,
      `Core: ${runtimeInfo?.coreVersion ?? "n/a"} (latest ${runtimeInfo?.latestVersion ?? "n/a"})`,
      `Node: ${runtimeInfo?.nodeVersion ?? "n/a"} · npm: ${runtimeInfo?.npmVersion ?? "n/a"}`,
      systemInfo
        ? `OS: ${PLATFORM_NAMES[systemInfo.platform] ?? systemInfo.platform} ${systemInfo.osRelease} (${systemInfo.arch})`
        : "OS: n/a",
      systemInfo
        ? `CPU: ${systemInfo.cpuModel ?? "n/a"} × ${systemInfo.cpuCount}`
        : "CPU: n/a",
      systemInfo
        ? `Memory: ${formatBytes(memUsed)} / ${formatBytes(systemInfo.totalMemory)}`
        : "Memory: n/a",
      systemInfo
        ? `Electron ${systemInfo.electronVersion} · Chrome ${systemInfo.chromeVersion} · packaged=${systemInfo.packaged}`
        : "",
      `Logs: ${paths.logs ?? "n/a"}`,
    ].filter(Boolean)
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      showToast(t("settings.runtime.diagnosticsCopied"), "success")
    } catch {
      showToast(t("settings.runtime.diagnosticsCopyFailed"), "error")
    }
  }

  return (
    <>
      {/* The poll interval belongs to the whole page — three of the four cards
          below are live readings — so it is stated once, up here, instead of
          under the one card that used to carry it. */}
      <p className="mb-4 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <RefreshCw className="size-3" />
        {t("settings.runtime.refreshNote")}
      </p>

      <SettingsCard title={t("settings.runtime.versionsGroup")}>
        <InfoRow
          label={t("settings.runtime.nodejs")}
          value={runtimeInfo?.nodeVersion || t("common.notInstalled")}
          mono
          trailing={<StatusChip ok={!!runtimeInfo?.nodeVersion} />}
        />
        <InfoRow
          label={t("settings.runtime.npm")}
          value={
            runtimeInfo?.npmVersion
              ? `v${runtimeInfo.npmVersion}`
              : t("common.notInstalled")
          }
          mono
          trailing={<StatusChip ok={!!runtimeInfo?.npmVersion} />}
        />
        {/* Core carries its own freshness: the installed version, the verdict
            as a chip, and — only when it is behind — what it would move to. */}
        <InfoRow
          label={t("settings.runtime.coreLibrary")}
          value={
            runtimeInfo?.coreVersion
              ? `v${runtimeInfo.coreVersion}`
              : t("common.notInstalled")
          }
          mono
          hint={
            runtimeInfo?.latestVersion && !coreUpToDate
              ? `${t("settings.runtime.latestAvailable")} v${runtimeInfo.latestVersion}`
              : undefined
          }
          trailing={
            runtimeInfo?.coreVersion && runtimeInfo.latestVersion ? (
              <Badge variant={coreUpToDate ? "success" : "warning"} size="sm">
                {coreUpToDate
                  ? t("settings.runtime.upToDate")
                  : t("settings.runtime.updateAvailable")}
              </Badge>
            ) : (
              <StatusChip ok={!!runtimeInfo?.coreVersion} />
            )
          }
        />
      </SettingsCard>

      {/* The machine, not the app: Electron and Chrome versions belong to the
          build identity and are listed on About instead. */}
      <SettingsCard title={t("settings.runtime.systemGroup")}>
        {systemInfo ? (
          <>
            <InfoRow
              label={t("settings.runtime.os")}
              value={`${PLATFORM_NAMES[systemInfo.platform] ?? systemInfo.platform} ${systemInfo.osRelease}`}
            />
            <InfoRow label={t("settings.runtime.arch")} value={systemInfo.arch} mono />
            <InfoRow
              label={t("settings.runtime.cpu")}
              value={`${systemInfo.cpuModel ?? "—"} × ${systemInfo.cpuCount}`}
            />
            <InfoRow
              label={t("settings.runtime.totalMemory")}
              value={formatBytes(systemInfo.totalMemory)}
            />
            {systemInfo.diskFree !== null && (
              <InfoRow
                label={t("settings.runtime.diskFree")}
                value={formatBytes(systemInfo.diskFree)}
                hint={
                  systemInfo.diskTotal
                    ? t("settings.runtime.diskTotal", {
                        total: formatBytes(systemInfo.diskTotal),
                      })
                    : undefined
                }
              />
            )}
          </>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">{t("common.loading")}</p>
        )}
      </SettingsCard>

      <SettingsCard title={t("settings.runtime.healthGroup")}>
        <Row
          label={t("settings.runtime.systemMemory")}
          desc={
            systemInfo
              ? t("settings.runtime.memoryUsage", {
                  used: formatBytes(memUsed),
                  total: formatBytes(systemInfo.totalMemory),
                })
              : t("common.loading")
          }
        >
          <span className="text-xs font-medium tabular-nums">{memPercent}%</span>
        </Row>
        <InfoRow
          label={t("settings.runtime.appMemory")}
          value={systemInfo ? formatBytes(systemInfo.appMemory) : "—"}
        />
        <InfoRow
          label={t("settings.runtime.appCpu")}
          value={systemInfo ? `${systemInfo.appCpu.toFixed(1)}%` : "—"}
        />
        <InfoRow
          label={t("settings.runtime.uptime")}
          value={systemInfo ? formatUptime(systemInfo.uptime) : "—"}
        />
      </SettingsCard>

      <SettingsCard title={t("settings.runtime.diagnosticsGroup")}>
        <Row
          label={t("settings.runtime.openLogs")}
          desc={t("settings.runtime.openLogsDesc")}
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!paths.logs}
            onClick={() => paths.logs && void window.api.showPath(paths.logs)}
          >
            <FolderOpen />
            {t("common.reveal")}
          </Button>
        </Row>
        <Row
          label={t("settings.runtime.copyDiagnostics")}
          desc={t("settings.runtime.copyDiagnosticsDesc")}
        >
          <Button size="sm" variant="outline" onClick={() => void copyDiagnostics()}>
            <ClipboardCopy />
            {t("settings.runtime.copy")}
          </Button>
        </Row>
      </SettingsCard>
    </>
  )
}

function StatusChip({ ok }: { ok: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Badge variant={ok ? "success" : "danger"} size="sm">
      {ok ? t("settings.runtime.ok") : t("common.notInstalled")}
    </Badge>
  )
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
