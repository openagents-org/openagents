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
import { PageHeader } from "../../components/layout/page-header"
import { Switch } from "../../components/shadcn/switch"
import { SettingsCard, Row } from "./components/settings-card"
import { LauncherUpdate } from "./components/launcher-update"
import { Separator } from "../../components/shadcn/separator"
import { Input } from "../../components/shadcn/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/shadcn/select"
import { Button } from "../../components/shadcn/button"
import { ConfirmDialog } from "../../components/ui-kit"
import { useThemeStore, type ThemeMode } from "../../store/theme"
import { useAgentsStore } from "../../store/agents"
import { useNotificationsStore } from "../../store/notifications"
import { useUiStore } from "../../store/ui"
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

/** Radix Select rejects an empty item value, so "no default" needs a sentinel. */
const NO_DEFAULT_AGENT = "__none__"

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
  const [downloadRegion, setDownloadRegion] = useState("auto")
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
      setDownloadRegion((all.downloadRegion as string) || "auto")
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

  // Deep-link from elsewhere in the app (currently the update banner's "view
  // progress" / "update now"), which needs to land on a specific section rather
  // than the default General. Keyed off the signal too, so re-requesting a
  // section the user has since navigated away from still re-selects it.
  const deepLinkSection = useUiStore((s) => s.settingsSection)
  const deepLinkSignal = useUiStore((s) => s.settingsSectionSignal)
  useEffect(() => {
    if (!deepLinkSection) return
    if (SECTIONS.some((s) => s.id === deepLinkSection)) {
      setSection(deepLinkSection as SectionId)
    }
  }, [deepLinkSection, deepLinkSignal])

  // Auto-check the moment the user opens the Updates section, so it immediately
  // resolves to "Up to date (vX)" or "New version available" instead of sitting
  // on a stale "Current version · Check for updates". Skips when a check or
  // download is already in flight. Manual checks stay user-driven (no
  // auto-download).
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
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={importSettings} title={t("common.import")}>
              <ArrowUpFromLine className="w-3 h-3" />
              {t("common.import")}
            </Button>
            <Button size="sm" variant="outline" onClick={exportSettings} title={t("common.export")}>
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
        <aside className="w-50 shrink-0">
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-sm bg-(--bg-input) text-2xs">
            <Search className="w-3 h-3 text-(--text-tertiary)" />
            <input
              placeholder={t("settings.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent border-0 outline-none flex-1 text-xs"
            />
          </div>
          <ul className="m-0 p-0 list-none">
            {visibleSections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-left text-xs border-0 cursor-pointer mb-px",
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
                        "px-3 py-1.5 rounded-sm text-xs border cursor-pointer",
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
                  value={defaultAgentType || NO_DEFAULT_AGENT}
                  disabled
                  onValueChange={(v) => {
                    const next = v === NO_DEFAULT_AGENT ? "" : v
                    setDefaultAgentType(next)
                    void set("defaultAgentType", next)
                  }}
                >
                  <SelectTrigger size="sm" className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEFAULT_AGENT}>{t("common.none")}</SelectItem>
                    {agentTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
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
              <p className="text-2xs text-(--text-tertiary) m-0 mt-2">
                {t("settings.notifications.note")}
              </p>
            </SettingsCard>
          )}

          {section === "network" && (
            <SettingsCard title={t("settings.network.title")}>
              {/* Routes the Node runtime, npm and the agent core through
                  npmmirror. It was previously auto-detected from timezone/locale
                  with no way to correct a wrong guess — which left users on a
                  slow origin with no recourse but a system-wide proxy. */}
              <Row
                label={t("settings.network.downloadRegion")}
                desc={t("settings.network.downloadRegionDesc")}
              >
                <Select
                  value={downloadRegion}
                  onValueChange={(v) => {
                    setDownloadRegion(v)
                    void set("downloadRegion", v)
                  }}
                >
                  <SelectTrigger size="sm" className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("settings.network.regionAuto")}</SelectItem>
                    <SelectItem value="cn">{t("settings.network.regionCn")}</SelectItem>
                    <SelectItem value="global">{t("settings.network.regionGlobal")}</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Separator />
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
              <p className="text-2xs text-(--text-tertiary) m-0 mt-3">
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
                        <div className="text-xs font-medium text-(--text-primary)">
                          {label}
                        </div>
                        <div className="text-2xs text-(--text-tertiary) truncate font-mono">
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
                <p className="text-xs text-(--text-tertiary)">{t("common.loading")}</p>
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
                  onValueChange={(v) => void changeLanguage(v as LanguageCode)}
                >
                  <SelectTrigger size="sm" className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
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
                    "flex justify-between items-center py-2.5 text-sm border-b border-(--border)",
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
              <p className="text-sm m-0 mb-2 flex items-center gap-1.5">
                {t("settings.about.appLine", { version: launcherVersion })}
              </p>
              <p className="text-sm m-0">
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
