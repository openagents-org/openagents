import React from "react"
import { useTranslation } from "react-i18next"
import { ClipboardCopy, FolderOpen } from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { Progress } from "@renderer/components/ui/progress"
import {
  SectionHeading,
  SettingsCard,
  Row,
  InfoRow,
} from "../components/settings-card"
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
      <SectionHeading
        title={t("settings.pages.runtime.title")}
        desc={t("settings.pages.runtime.desc")}
      />

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
        <InfoRow
          label={t("settings.runtime.coreLibrary")}
          value={
            runtimeInfo?.coreVersion
              ? `v${runtimeInfo.coreVersion}`
              : t("common.notInstalled")
          }
          mono
          trailing={<StatusChip ok={!!runtimeInfo?.coreVersion} />}
        />
        <InfoRow
          label={t("settings.runtime.latestAvailable")}
          value={
            runtimeInfo?.latestVersion
              ? `v${runtimeInfo.latestVersion}`
              : t("settings.runtime.unableToCheck")
          }
          mono
          trailing={
            runtimeInfo?.latestVersion ? (
              <Badge variant={coreUpToDate ? "success" : "warning"} size="sm">
                {coreUpToDate
                  ? t("settings.runtime.upToDate")
                  : t("settings.runtime.updateAvailable")}
              </Badge>
            ) : undefined
          }
        />
      </SettingsCard>

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
            <InfoRow
              label={t("settings.runtime.electron")}
              value={`Electron ${systemInfo.electronVersion} · Chrome ${systemInfo.chromeVersion}`}
              mono
            />
          </>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">{t("common.loading")}</p>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("settings.runtime.healthGroup")}
        desc={t("settings.runtime.healthGroupDesc")}
      >
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
          <div className="flex w-32 items-center gap-2">
            <Progress value={memPercent} className="h-1.5" />
            <span className="w-9 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
              {memPercent}%
            </span>
          </div>
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

const UNITS = ["B", "KB", "MB", "GB", "TB"]

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "—"
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${UNITS[unit]}`
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
