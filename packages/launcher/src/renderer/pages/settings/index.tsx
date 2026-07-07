import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Settings as Cog,
  Cpu,
  Globe,
  HardDrive,
  Languages,
  Palette,
  Bell,
  Download,
  Search,
  ExternalLink,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { SUPPORTED_LANGUAGES, changeLanguage, type LanguageCode } from "../../i18n"
import { TopBar } from "../../components/TopBar"
import { Switch } from "../../components/ui/Switch"
import { Label } from "../../components/ui/Label"
import { Separator } from "../../components/ui/Separator"
import { Input } from "../../components/ui/Input"
import { Select } from "../../components/ui/Select"
import { Button } from "../../components/ui/Button"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"
import { useThemeStore, type ThemeMode } from "../../store/theme"
import { useAgentsStore } from "../../store/agents"
import { useNotificationsStore } from "../../store/notifications"
import type { RuntimeInfo, UpdaterState } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"

interface SettingsProps {
  showToast: (msg: string, type?: ToastType) => void
}

type SectionId =
  | "general"
  | "appearance"
  | "agents"
  | "notifications"
  | "network"
  | "data"
  | "language"
  | "updates"
  | "runtime"
  | "about"

const SECTIONS: Array<{ id: SectionId; icon: React.JSX.Element }> = [
  { id: "general", icon: <Cog className="w-4 h-4" /> },
  { id: "appearance", icon: <Palette className="w-4 h-4" /> },
  { id: "agents", icon: <Cpu className="w-4 h-4" /> },
  { id: "notifications", icon: <Bell className="w-4 h-4" /> },
  { id: "network", icon: <Globe className="w-4 h-4" /> },
  { id: "data", icon: <HardDrive className="w-4 h-4" /> },
  { id: "language", icon: <Languages className="w-4 h-4" /> },
  { id: "updates", icon: <Download className="w-4 h-4" /> },
  { id: "runtime", icon: <Cpu className="w-4 h-4" /> },
  { id: "about", icon: <ExternalLink className="w-4 h-4" /> },
]

export default function Settings({ showToast }: SettingsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [section, setSection] = useState<SectionId>("general")
  const [search, setSearch] = useState("")
  const [startOnBoot, setStartOnBoot] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [gpuAccel, setGpuAccel] = useState(true)
  const [defaultAgentType, setDefaultAgentType] = useState("")
  const [defaultModel, setDefaultModel] = useState("")
  const [autoStart, setAutoStart] = useState(false)
  const [httpProxy, setHttpProxy] = useState("")
  const [httpsProxy, setHttpsProxy] = useState("")
  const [noProxy, setNoProxy] = useState("")
  const [workspaceEndpoint, setWorkspaceEndpoint] = useState("")
  const [paths, setPaths] = useState<{
    userData: string
    logs: string
    downloads: string
    home: string
    cache: string
    portableNode: string
    openagentsHome: string
  } | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [launcherVersion, setLauncherVersion] = useState<string>("--")
  const mounted = useRef(true)

  const { mode: themeMode, setMode: setThemeMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )
  const agents = useAgentsStore((s) => s.agents)
  const { prefs: notifPrefs, setPrefs: setNotifPrefs } = useNotificationsStore(
    useShallow((s) => ({ prefs: s.prefs, setPrefs: s.setPrefs })),
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const all = (await window.api.getAllSettings()) as Record<string, unknown>
      if (!mounted.current) return
      setStartOnBoot(!!all.startOnBoot)
      // Default on: closing the window hides to tray unless the user opts out.
      setMinimizeToTray(all.minimizeToTray !== false)
      setAutoUpdate(all.autoUpdate !== false)
      setGpuAccel(all.gpuAcceleration !== false)
      setDefaultAgentType((all.defaultAgentType as string) || "")
      setDefaultModel((all.defaultModel as string) || "")
      setAutoStart(!!all.agentAutoStart)
      setHttpProxy((all.httpProxy as string) || "")
      setHttpsProxy((all.httpsProxy as string) || "")
      setNoProxy((all.noProxy as string) || "")
      setWorkspaceEndpoint((all.workspaceEndpoint as string) || "")
    } catch {}
  }, [])

  const loadPaths = useCallback(async () => {
    try {
      const p = await window.api.listPaths()
      if (mounted.current) setPaths(p)
    } catch {}
  }, [])

  const loadRuntime = useCallback(async () => {
    try {
      const info = await window.api.runtimeInfo()
      if (mounted.current) setRuntimeInfo(info)
    } catch {}
  }, [])

  const loadLauncherVersion = useCallback(async () => {
    try {
      const status = await window.api.pythonStatus()
      if (mounted.current && status.launcherVersion)
        setLauncherVersion(`v${status.launcherVersion}`)
    } catch {}
  }, [])

  useEffect(() => {
    loadSettings()
    loadPaths()
    loadRuntime()
    loadLauncherVersion()
    const id = setInterval(loadRuntime, 8000)
    return () => clearInterval(id)
  }, [loadSettings, loadPaths, loadRuntime, loadLauncherVersion])

  // ── Launcher self-update ──
  const [updater, setUpdater] = useState<UpdaterState | null>(null)

  useEffect(() => {
    window.api
      .getUpdaterState()
      .then((s) => {
        if (mounted.current) setUpdater(s)
      })
      .catch(() => {})
    const off = window.api.onUpdaterEvent((s) => {
      if (mounted.current) setUpdater(s)
    })
    return off
  }, [])

  // Auto-check the moment the user opens the Updates section, so a supported
  // build immediately resolves to "Up to date (vX)" or "New version available"
  // instead of sitting on a stale "Current version · Check for updates". Skips
  // when a check/download is already in flight, and never on unsupported (dev)
  // builds. Manual checks stay user-driven (no auto-download).
  useEffect(() => {
    if (section !== "updates") return
    if (!updater?.supported) return
    const s = updater.status
    if (s === "checking" || s === "downloading" || s === "downloaded") return
    window.api.checkLauncherUpdate().then(
      (next) => {
        if (mounted.current) setUpdater(next)
      },
      () => {},
    )
    // Only re-run when the section changes, not on every updater tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const checkUpdate = async (): Promise<void> => {
    try {
      const s = await window.api.checkLauncherUpdate()
      setUpdater(s)
      if (s.status === "not-available")
        showToast(t("settings.toasts.alreadyUpToDate"), "success")
    } catch (e) {
      showToast(t("settings.toasts.updateCheckFailed", { error: (e as Error).message }), "error")
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    try {
      await window.api.downloadLauncherUpdate()
    } catch (e) {
      showToast(t("settings.toasts.downloadFailed", { error: (e as Error).message }), "error")
    }
  }

  const installUpdate = async (): Promise<void> => {
    try {
      await window.api.installLauncherUpdate()
    } catch (e) {
      showToast(t("settings.toasts.installFailed", { error: (e as Error).message }), "error")
    }
  }

  const set = async (key: string, value: unknown): Promise<void> => {
    await window.api.setSetting(key, value)
  }

  const exportSettings = async (): Promise<void> => {
    try {
      const json = await window.api.exportSettings()
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `openagents-settings-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(t("settings.toasts.exported"), "success")
    } catch (e) {
      showToast(t("settings.toasts.exportFailed", { error: (e as Error).message }), "error")
    }
  }

  const importSettings = async (): Promise<void> => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json"
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const res = await window.api.importSettings(text)
      if (res.ok) {
        await loadSettings()
        showToast(t("settings.toasts.imported"), "success")
      } else {
        showToast(t("settings.toasts.importFailed", { error: res.error || t("settings.toasts.unknown") }), "error")
      }
    }
    input.click()
  }

  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const resetSettings = (): void => {
    setResetOpen(true)
  }

  const performReset = async (): Promise<void> => {
    setResetting(true)
    try {
      await window.api.resetSettings()
      await loadSettings()
      showToast(t("settings.toasts.reset"), "success")
    } finally {
      setResetting(false)
      setResetOpen(false)
    }
  }

  const visibleSections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.filter((s) => t(`settings.sections.${s.id}`).toLowerCase().includes(q))
  }, [search, t])

  const runtimeRows = useMemo<Array<{ label: string; value: string; color?: string }>>(() => {
    if (!runtimeInfo) {
      return [
        { label: t("settings.runtime.nodejs"), value: t("common.checking") },
        { label: t("settings.runtime.npm"), value: t("common.checking") },
        { label: t("settings.runtime.coreLibrary"), value: t("common.checking") },
        { label: t("settings.runtime.latestAvailable"), value: t("common.checking") },
      ]
    }
    const upToDate =
      !!runtimeInfo.latestVersion &&
      runtimeInfo.coreVersion === runtimeInfo.latestVersion
    return [
      {
        label: t("settings.runtime.nodejs"),
        value: runtimeInfo.nodeVersion || t("common.notInstalled"),
        color: runtimeInfo.nodeVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: t("settings.runtime.npm"),
        value: runtimeInfo.npmVersion ? `v${runtimeInfo.npmVersion}` : t("common.notInstalled"),
        color: runtimeInfo.npmVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: t("settings.runtime.coreLibrary"),
        value: runtimeInfo.coreVersion ? `v${runtimeInfo.coreVersion}` : t("common.notInstalled"),
        color: runtimeInfo.coreVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: t("settings.runtime.latestAvailable"),
        value: runtimeInfo.latestVersion
          ? `v${runtimeInfo.latestVersion}${upToDate ? t("settings.runtime.upToDateSuffix") : t("settings.runtime.updateAvailableSuffix")}`
          : t("settings.runtime.unableToCheck"),
        color: runtimeInfo.latestVersion
          ? upToDate
            ? "var(--success-text)"
            : "var(--warning-text)"
          : undefined,
      },
    ]
  }, [runtimeInfo, t])

  const agentTypes = useMemo(() => {
    const set = new Set<string>()
    for (const a of agents) if (a.type) set.add(a.type)
    return Array.from(set).sort()
  }, [agents])

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        actions={
          <>
            <Button size="sm" onClick={importSettings} title={t("common.import")}>
              <ArrowUpFromLine className="w-3 h-3" />
              {t("common.import")}
            </Button>
            <Button size="sm" onClick={exportSettings} title={t("common.export")}>
              <ArrowDownToLine className="w-3 h-3" />
              {t("common.export")}
            </Button>
            <Button size="sm" variant="destructive" onClick={resetSettings}>
              <RotateCcw className="w-3 h-3" />
              {t("common.reset")}
            </Button>
          </>
        }
      />

      <div className="flex flex-1 min-h-0 gap-5 px-9 py-6">
        <aside className="w-[200px] shrink-0">
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-sm bg-(--bg-input) text-[11px]">
            <Search className="w-3 h-3 text-(--text-tertiary)" />
            <input
              placeholder={t("settings.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent border-0 outline-none flex-1 text-[12px]"
            />
          </div>
          <ul className="m-0 p-0 list-none">
            {visibleSections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-left text-[12px] border-0 cursor-pointer mb-[2px]",
                    section === s.id
                      ? "bg-(--accent) text-white"
                      : "bg-transparent text-(--text-secondary) hover:bg-(--bg-input)",
                  )}
                >
                  <span className={section === s.id ? "" : "opacity-70"}>{s.icon}</span>
                  {t(`settings.sections.${s.id}`)}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto pr-2">
          {section === "general" && (
            <SettingsCard title={t("settings.general.title")}>
              <Row
                label={t("settings.general.startOnBoot")}
                desc={t("settings.general.startOnBootDesc")}
              >
                <Switch
                  checked={startOnBoot}
                  onCheckedChange={(v) => {
                    setStartOnBoot(v)
                    void set("startOnBoot", v)
                  }}
                />
              </Row>
              <Separator />
              <Row
                label={t("settings.general.minimizeToTray")}
                desc={t("settings.general.minimizeToTrayDesc")}
              >
                <Switch
                  checked={minimizeToTray}
                  onCheckedChange={(v) => {
                    setMinimizeToTray(v)
                    void set("minimizeToTray", v)
                  }}
                />
              </Row>
              <Separator />
              <Row
                label={t("settings.general.gpuAcceleration")}
                desc={t("settings.general.gpuAccelerationDesc")}
              >
                <Switch
                  checked={gpuAccel}
                  onCheckedChange={(v) => {
                    setGpuAccel(v)
                    void set("gpuAcceleration", v)
                  }}
                />
              </Row>
            </SettingsCard>
          )}

          {section === "appearance" && (
            <SettingsCard title={t("settings.appearance.title")}>
              <Row label={t("settings.appearance.theme")} desc={t("settings.appearance.themeDesc")}>
                <div className="flex gap-1.5">
                  {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setThemeMode(m)}
                      className={cn(
                        "px-3 py-1.5 rounded-sm text-[12px] border cursor-pointer",
                        themeMode === m
                          ? "border-(--accent) bg-(--accent-bg) text-(--accent) font-semibold"
                          : "border-(--border) bg-(--bg-card) text-(--text-secondary) hover:border-(--border-hover)",
                      )}
                    >
                      {t(`settings.appearance.modes.${m}`)}
                    </button>
                  ))}
                </div>
              </Row>
            </SettingsCard>
          )}

          {section === "agents" && (
            <SettingsCard title={t("settings.agents.title")}>
              <Row
                label={`${t("settings.agents.defaultType")} · ${t("common.comingSoon")}`}
                desc={t("settings.agents.defaultTypeDesc")}
              >
                <Select
                  value={defaultAgentType}
                  disabled
                  onChange={(e) => {
                    setDefaultAgentType(e.target.value)
                    void set("defaultAgentType", e.target.value)
                  }}
                  className="w-[200px]"
                >
                  <option value="">{t("common.none")}</option>
                  {agentTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Row>
              <Separator />
              <Row
                stacked
                label={`${t("settings.agents.defaultModel")} · ${t("common.comingSoon")}`}
                desc={t("settings.agents.defaultModelDesc")}
              >
                <Input
                  value={defaultModel}
                  disabled
                  onChange={(e) => setDefaultModel(e.target.value)}
                  onBlur={() => void set("defaultModel", defaultModel)}
                  placeholder={t("settings.agents.defaultModelPlaceholder")}
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row
                label={`${t("settings.agents.autoStart")} · ${t("common.comingSoon")}`}
                desc={t("settings.agents.autoStartDesc")}
              >
                <Switch
                  checked={autoStart}
                  disabled
                  onCheckedChange={(v) => {
                    setAutoStart(v)
                    void set("agentAutoStart", v)
                  }}
                />
              </Row>
            </SettingsCard>
          )}

          {section === "notifications" && (
            <SettingsCard title={t("settings.notifications.title")}>
              <Row
                label={t("settings.notifications.enable")}
                desc={t("settings.notifications.enableDesc")}
              >
                <Switch
                  checked={!!notifPrefs?.enabled}
                  onCheckedChange={(v) => void setNotifPrefs({ enabled: v })}
                />
              </Row>
              <Separator />
              <Row
                label={t("settings.notifications.sound")}
                desc={t("settings.notifications.soundDesc")}
              >
                <Switch
                  checked={!!notifPrefs?.soundEnabled}
                  onCheckedChange={(v) => void setNotifPrefs({ soundEnabled: v })}
                />
              </Row>
              <Separator />
              <p className="text-[11px] text-(--text-tertiary) m-0 mt-2">
                {t("settings.notifications.note")}
              </p>
            </SettingsCard>
          )}

          {section === "network" && (
            <SettingsCard title={t("settings.network.title")}>
              <Row
                stacked
                label={t("settings.network.workspaceUrl")}
                desc={t("settings.network.workspaceUrlDesc")}
              >
                <Input
                  value={workspaceEndpoint}
                  onChange={(e) => setWorkspaceEndpoint(e.target.value)}
                  onBlur={() => void set("workspaceEndpoint", workspaceEndpoint)}
                  placeholder={t("settings.network.workspaceUrlPlaceholder")}
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row
                stacked
                label={t("settings.network.httpProxy")}
                desc={t("settings.network.httpProxyDesc")}
              >
                <Input
                  value={httpProxy}
                  onChange={(e) => setHttpProxy(e.target.value)}
                  onBlur={() => void set("httpProxy", httpProxy)}
                  placeholder={t("settings.network.proxyPlaceholder")}
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row stacked label={t("settings.network.httpsProxy")} desc={t("settings.network.httpsProxyDesc")}>
                <Input
                  value={httpsProxy}
                  onChange={(e) => setHttpsProxy(e.target.value)}
                  onBlur={() => void set("httpsProxy", httpsProxy)}
                  placeholder={t("settings.network.proxyPlaceholder")}
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row
                stacked
                label={t("settings.network.noProxy")}
                desc={t("settings.network.noProxyDesc")}
              >
                <Input
                  value={noProxy}
                  onChange={(e) => setNoProxy(e.target.value)}
                  onBlur={() => void set("noProxy", noProxy)}
                  placeholder={t("settings.network.noProxyPlaceholder")}
                  className="w-full"
                />
              </Row>
              <p className="text-[11px] text-(--text-tertiary) m-0 mt-3">
                {t("settings.network.note")}
              </p>
            </SettingsCard>
          )}

          {section === "data" && (
            <SettingsCard title={t("settings.data.title")}>
              {paths ? (
                <ul className="m-0 p-0 list-none">
                  {[
                    [t("settings.data.userData"), paths.userData],
                    [t("settings.data.openagentsHome"), paths.openagentsHome],
                    [t("settings.data.logs"), paths.logs],
                    [t("settings.data.downloads"), paths.downloads],
                    [t("settings.data.cache"), paths.cache],
                    [t("settings.data.portableNode"), paths.portableNode],
                  ].map(([label, p]) => (
                    <li
                      key={label}
                      className="flex items-center justify-between gap-3 py-2.5 border-b border-(--border) last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-(--text-primary)">
                          {label}
                        </div>
                        <div className="text-[11px] text-(--text-tertiary) truncate font-mono">
                          {p}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => void window.api.showPath(p)}>
                        {t("common.reveal")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-(--text-tertiary)">{t("common.loading")}</p>
              )}
            </SettingsCard>
          )}

          {section === "language" && (
            <SettingsCard title={t("settings.language.title")}>
              <Row
                label={t("settings.language.displayLanguage")}
                desc={t("settings.language.displayLanguageDesc")}
              >
                <Select
                  value={(i18n.resolvedLanguage ?? i18n.language) as LanguageCode}
                  onChange={(e) => void changeLanguage(e.target.value as LanguageCode)}
                  className="w-[200px]"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Row>
            </SettingsCard>
          )}

          {section === "updates" && (
            <SettingsCard title={t("settings.updates.title")}>
              <Row
                label={t("settings.updates.autoUpdate")}
                desc={t("settings.updates.autoUpdateDesc")}
              >
                <Switch
                  checked={autoUpdate}
                  onCheckedChange={(v) => {
                    setAutoUpdate(v)
                    void set("autoUpdate", v)
                  }}
                />
              </Row>
              <Separator />
              <LauncherUpdate
                state={updater}
                currentVersion={launcherVersion}
                onCheck={checkUpdate}
                onDownload={downloadUpdate}
                onInstall={installUpdate}
              />
            </SettingsCard>
          )}

          {section === "runtime" && (
            <SettingsCard title={t("settings.runtime.title")}>
              {runtimeRows.map((row, idx) => (
                <div
                  key={row.label}
                  className={cn(
                    "flex justify-between items-center py-2.5 text-[13px] border-b border-(--border)",
                    idx === runtimeRows.length - 1 && "border-b-0",
                  )}
                >
                  <span className="text-(--text-secondary)">{row.label}</span>
                  <span style={{ color: row.color }}>{row.value}</span>
                </div>
              ))}
            </SettingsCard>
          )}

          {section === "about" && (
            <SettingsCard title={t("settings.about.title")}>
              <p className="text-[13px] m-0 mb-2 flex items-center gap-1.5">
                {t("settings.about.appLine", { version: launcherVersion })}
              </p>
              <p className="text-[13px] m-0">
                <button
                  type="button"
                  className="bg-transparent border-0 p-0 text-(--accent) underline cursor-pointer"
                  onClick={() => {
                    window.api.openExternal("https://openagents.org/docs")
                  }}
                >
                  {t("common.documentation")}
                </button>
              </p>
            </SettingsCard>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title={t("settings.resetDialog.title")}
        description={t("settings.resetDialog.description")}
        confirmLabel={t("settings.resetDialog.confirm")}
        destructive
        busy={resetting}
        onCancel={() => {
          if (!resetting) setResetOpen(false)
        }}
        onConfirm={performReset}
      />
    </section>
  )
}

function LauncherUpdate({
  state,
  currentVersion,
  onCheck,
  onDownload,
  onInstall,
}: {
  state: UpdaterState | null
  currentVersion: string
  onCheck: () => void | Promise<void>
  onDownload: () => void | Promise<void>
  onInstall: () => void | Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const status = state?.status ?? "idle"
  const latest = state?.latestVersion ? `v${state.latestVersion}` : null

  // Dev build / missing update metadata: in-app update can't run, so point the
  // user at the download page instead of offering a dead button.
  if (state && !state.supported) {
    return (
      <Row
        label={t("settings.updates.appUpdate")}
        desc={t("settings.updates.cannotUpdate", { version: currentVersion })}
      >
        <Button
          variant="default"
          size="sm"
          onClick={() =>
            window.api.openExternal(
              state.downloadUrl ||
                "https://github.com/openagents-org/openagents/releases",
            )
          }
        >
          {t("settings.updates.downloadPage")}
        </Button>
      </Row>
    )
  }

  let statusText = t("settings.updates.currentVersion", { version: currentVersion })
  if (status === "checking") statusText = t("settings.updates.checking")
  else if (status === "available")
    statusText = t("settings.updates.available", { version: latest ?? "" })
  else if (status === "downloading")
    statusText = t("settings.updates.downloading", { version: latest ?? "", percent: state?.percent ?? 0 })
  else if (status === "downloaded")
    statusText = t("settings.updates.downloaded", { version: latest ?? t("settings.updates.updateFallback") })
  else if (status === "not-available")
    statusText = t("settings.updates.upToDate", { version: currentVersion })
  else if (status === "error")
    statusText = t("settings.updates.error", { error: state?.error ?? t("settings.toasts.unknown") })

  const busy = status === "checking" || status === "downloading"

  let action: React.JSX.Element
  if (status === "available") {
    action = (
      <Button variant="primary" size="sm" onClick={() => void onDownload()}>
        {t("common.download")}
      </Button>
    )
  } else if (status === "downloading") {
    action = (
      <Button variant="default" size="sm" disabled>
        {t("settings.updates.actionDownloading")}
      </Button>
    )
  } else if (status === "downloaded") {
    action = (
      <Button variant="primary" size="sm" onClick={() => void onInstall()}>
        {t("settings.updates.actionRestartInstall")}
      </Button>
    )
  } else {
    action = (
      <Button
        variant="default"
        size="sm"
        disabled={busy}
        onClick={() => void onCheck()}
      >
        {status === "checking" ? t("settings.updates.actionChecking") : t("settings.updates.actionCheck")}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <span
          className={cn(
            "text-[13px] font-medium min-w-0 truncate",
            status === "error"
              ? "text-(--danger-text)"
              : status === "available" || status === "downloaded"
                ? "text-(--accent)"
                : "text-(--text-primary)",
          )}
        >
          {statusText}
        </span>
        <div className="shrink-0">{action}</div>
      </div>
      {status === "downloading" && (
        <div className="h-1.5 w-full rounded-full bg-(--bg-input) overflow-hidden">
          <div
            className="h-full bg-(--accent) transition-[width] duration-200"
            style={{ width: `${state?.percent ?? 0}%` }}
          />
        </div>
      )}
    </div>
  )
}

function SettingsCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="bg-(--bg-card) border border-(--border) rounded-(--radius) px-5 py-4 mb-4">
      <h3 className="m-0 mb-3 text-[14px] font-semibold tracking-[-0.01em]">
        {title}
      </h3>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function Row({
  label,
  desc,
  children,
  stacked,
}: {
  label: string
  desc?: string
  children: React.ReactNode
  /** Stack label above the control. Use for wide inputs / long descriptions
   *  where the side-by-side layout would crush the label column. */
  stacked?: boolean
}): React.JSX.Element {
  if (stacked) {
    return (
      <div className="flex flex-col gap-2 py-2.5">
        <Label plain className="m-0 normal-case tracking-normal">
          <span className="text-[13px] font-medium text-(--text-primary)">
            {label}
          </span>
          {desc && (
            <span className="block text-[11px] text-(--text-tertiary) font-normal mt-0.5">
              {desc}
            </span>
          )}
        </Label>
        <div className="w-full">{children}</div>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <Label plain className="m-0 normal-case tracking-normal min-w-0">
        <span className="text-[13px] font-medium text-(--text-primary)">
          {label}
        </span>
        {desc && (
          <span className="block text-[11px] text-(--text-tertiary) font-normal mt-0.5">
            {desc}
          </span>
        )}
      </Label>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
