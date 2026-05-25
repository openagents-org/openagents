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
import type { RuntimeInfo } from "../../types"
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

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.JSX.Element }> = [
  { id: "general", label: "General", icon: <Cog className="w-4 h-4" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="w-4 h-4" /> },
  { id: "agents", label: "Agents", icon: <Cpu className="w-4 h-4" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  { id: "network", label: "Network", icon: <Globe className="w-4 h-4" /> },
  { id: "data", label: "Data", icon: <HardDrive className="w-4 h-4" /> },
  { id: "language", label: "Language", icon: <Languages className="w-4 h-4" /> },
  { id: "updates", label: "Updates", icon: <Download className="w-4 h-4" /> },
  { id: "runtime", label: "Runtime", icon: <Cpu className="w-4 h-4" /> },
  { id: "about", label: "About", icon: <ExternalLink className="w-4 h-4" /> },
]

export default function Settings({ showToast }: SettingsProps): React.JSX.Element {
  const [section, setSection] = useState<SectionId>("general")
  const [search, setSearch] = useState("")
  const [startOnBoot, setStartOnBoot] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updateChannel, setUpdateChannel] = useState<"stable" | "beta">("stable")
  const [gpuAccel, setGpuAccel] = useState(true)
  const [defaultAgentType, setDefaultAgentType] = useState("")
  const [defaultModel, setDefaultModel] = useState("")
  const [autoStart, setAutoStart] = useState(false)
  const [httpProxy, setHttpProxy] = useState("")
  const [httpsProxy, setHttpsProxy] = useState("")
  const [noProxy, setNoProxy] = useState("")
  const [workspaceEndpoint, setWorkspaceEndpoint] = useState("")
  const [language, setLanguage] = useState("en")
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
      setMinimizeToTray(!!all.minimizeToTray)
      setAutoUpdate(all.autoUpdate !== false)
      setUpdateChannel((all.updateChannel as "stable" | "beta") || "stable")
      setGpuAccel(all.gpuAcceleration !== false)
      setDefaultAgentType((all.defaultAgentType as string) || "")
      setDefaultModel((all.defaultModel as string) || "")
      setAutoStart(!!all.agentAutoStart)
      setHttpProxy((all.httpProxy as string) || "")
      setHttpsProxy((all.httpsProxy as string) || "")
      setNoProxy((all.noProxy as string) || "")
      setWorkspaceEndpoint((all.workspaceEndpoint as string) || "")
      setLanguage((all.language as string) || "en")
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
      showToast("Exported settings", "success")
    } catch (e) {
      showToast(`Export failed: ${(e as Error).message}`, "error")
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
        showToast("Imported settings", "success")
      } else {
        showToast(`Import failed: ${res.error || "unknown"}`, "error")
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
      showToast("Settings reset", "success")
    } finally {
      setResetting(false)
      setResetOpen(false)
    }
  }

  const visibleSections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q))
  }, [search])

  const runtimeRows = useMemo<Array<{ label: string; value: string; color?: string }>>(() => {
    if (!runtimeInfo) {
      return [
        { label: "Node.js", value: "Checking..." },
        { label: "npm", value: "Checking..." },
        { label: "Core Library", value: "Checking..." },
        { label: "Latest Available", value: "Checking..." },
      ]
    }
    const upToDate =
      !!runtimeInfo.latestVersion &&
      runtimeInfo.coreVersion === runtimeInfo.latestVersion
    return [
      {
        label: "Node.js",
        value: runtimeInfo.nodeVersion || "Not installed",
        color: runtimeInfo.nodeVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: "npm",
        value: runtimeInfo.npmVersion ? `v${runtimeInfo.npmVersion}` : "Not installed",
        color: runtimeInfo.npmVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: "Core Library",
        value: runtimeInfo.coreVersion ? `v${runtimeInfo.coreVersion}` : "Not installed",
        color: runtimeInfo.coreVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: "Latest Available",
        value: runtimeInfo.latestVersion
          ? `v${runtimeInfo.latestVersion}${upToDate ? " (up to date)" : " (update available)"}`
          : "Unable to check",
        color: runtimeInfo.latestVersion
          ? upToDate
            ? "var(--success-text)"
            : "var(--warning-text)"
          : undefined,
      },
    ]
  }, [runtimeInfo])

  const agentTypes = useMemo(() => {
    const set = new Set<string>()
    for (const a of agents) if (a.type) set.add(a.type)
    return Array.from(set).sort()
  }, [agents])

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title="Settings"
        subtitle="— Preferences, network, data, updates"
        actions={
          <>
            <Button size="sm" onClick={importSettings} title="Import">
              <ArrowUpFromLine className="w-3 h-3" />
              Import
            </Button>
            <Button size="sm" onClick={exportSettings} title="Export">
              <ArrowDownToLine className="w-3 h-3" />
              Export
            </Button>
            <Button size="sm" variant="destructive" onClick={resetSettings}>
              <RotateCcw className="w-3 h-3" />
              Reset
            </Button>
          </>
        }
      />

      <div className="flex flex-1 min-h-0 gap-5 px-9 py-6">
        <aside className="w-[200px] shrink-0">
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-sm bg-(--bg-input) text-[11px]">
            <Search className="w-3 h-3 text-(--text-tertiary)" />
            <input
              placeholder="Search settings"
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
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto pr-2">
          {section === "general" && (
            <SettingsCard title="General">
              <Row
                label="Start on boot"
                desc="Launch automatically when you log in"
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
                label="Minimize to tray"
                desc="Keep running in system tray when window is closed"
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
                label="GPU acceleration"
                desc="Disable if you see rendering glitches (requires restart)"
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
            <SettingsCard title="Appearance">
              <Row label="Theme" desc="Choose how OpenAgents looks">
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
                      {m[0].toUpperCase()}{m.slice(1)}
                    </button>
                  ))}
                </div>
              </Row>
            </SettingsCard>
          )}

          {section === "agents" && (
            <SettingsCard title="Agent defaults">
              <Row
                label="Default agent type"
                desc="Pre-selected when creating a new agent"
              >
                <Select
                  value={defaultAgentType}
                  onChange={(e) => {
                    setDefaultAgentType(e.target.value)
                    void set("defaultAgentType", e.target.value)
                  }}
                  className="w-[200px]"
                >
                  <option value="">(none)</option>
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
                label="Default model"
                desc="Suggested model when configuring a new agent"
              >
                <Input
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  onBlur={() => void set("defaultModel", defaultModel)}
                  placeholder="e.g. claude-sonnet-4-5"
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row
                label="Auto-start on launch"
                desc="Start all configured agents when the launcher opens"
              >
                <Switch
                  checked={autoStart}
                  onCheckedChange={(v) => {
                    setAutoStart(v)
                    void set("agentAutoStart", v)
                  }}
                />
              </Row>
            </SettingsCard>
          )}

          {section === "notifications" && (
            <SettingsCard title="Notifications">
              <Row
                label="Enable notifications"
                desc="Show OS-level toasts for important events"
              >
                <Switch
                  checked={!!notifPrefs?.enabled}
                  onCheckedChange={(v) => void setNotifPrefs({ enabled: v })}
                />
              </Row>
              <Separator />
              <Row
                label="Play sound"
                desc="Audible cue when notifications fire"
              >
                <Switch
                  checked={!!notifPrefs?.soundEnabled}
                  onCheckedChange={(v) => void setNotifPrefs({ soundEnabled: v })}
                />
              </Row>
              <Separator />
              <p className="text-[11px] text-(--text-tertiary) m-0 mt-2">
                Fine-grained per-kind muting and quiet hours are available from
                the bell icon at the top right.
              </p>
            </SettingsCard>
          )}

          {section === "network" && (
            <SettingsCard title="Network">
              <Row
                stacked
                label="Workspace backend URL"
                desc="Optional self-hosted Workspace server. Leave blank to use OpenAgents hosted Workspace."
              >
                <Input
                  value={workspaceEndpoint}
                  onChange={(e) => setWorkspaceEndpoint(e.target.value)}
                  onBlur={() => void set("workspaceEndpoint", workspaceEndpoint)}
                  placeholder="https://workspace-endpoint.openagents.org or http://localhost:8000"
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row
                stacked
                label="HTTP proxy"
                desc="Used by agents and the launcher for outbound HTTP"
              >
                <Input
                  value={httpProxy}
                  onChange={(e) => setHttpProxy(e.target.value)}
                  onBlur={() => void set("httpProxy", httpProxy)}
                  placeholder="http://user:pass@host:port"
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row stacked label="HTTPS proxy" desc="Outbound HTTPS proxy">
                <Input
                  value={httpsProxy}
                  onChange={(e) => setHttpsProxy(e.target.value)}
                  onBlur={() => void set("httpsProxy", httpsProxy)}
                  placeholder="http://user:pass@host:port"
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row
                stacked
                label="No proxy"
                desc="Comma-separated hosts that bypass the proxy"
              >
                <Input
                  value={noProxy}
                  onChange={(e) => setNoProxy(e.target.value)}
                  onBlur={() => void set("noProxy", noProxy)}
                  placeholder="localhost,127.0.0.1,*.internal"
                  className="w-full"
                />
              </Row>
              <p className="text-[11px] text-(--text-tertiary) m-0 mt-3">
                Proxy values are persisted to launcher settings. Restart the
                launcher to apply.
              </p>
            </SettingsCard>
          )}

          {section === "data" && (
            <SettingsCard title="Data directories">
              {paths ? (
                <ul className="m-0 p-0 list-none">
                  {[
                    ["User data", paths.userData],
                    ["OpenAgents home", paths.openagentsHome],
                    ["Logs", paths.logs],
                    ["Downloads", paths.downloads],
                    ["Cache", paths.cache],
                    ["Portable Node.js", paths.portableNode],
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
                        Reveal
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-(--text-tertiary)">Loading…</p>
              )}
            </SettingsCard>
          )}

          {section === "language" && (
            <SettingsCard title="Language">
              <Row
                label="Display language"
                desc="UI strings (some areas may not yet be translated)"
              >
                <Select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value)
                    void set("language", e.target.value)
                  }}
                  className="w-[200px]"
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                  <option value="ja">日本語</option>
                </Select>
              </Row>
            </SettingsCard>
          )}

          {section === "updates" && (
            <SettingsCard title="Updates">
              <Row
                label="Automatic updates"
                desc="Check for new launcher and agent versions on launch"
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
              <Row label="Channel" desc="Stable or beta releases">
                <Select
                  value={updateChannel}
                  onChange={(e) => {
                    const v = e.target.value as "stable" | "beta"
                    setUpdateChannel(v)
                    void set("updateChannel", v)
                  }}
                  className="w-[160px]"
                >
                  <option value="stable">Stable</option>
                  <option value="beta">Beta</option>
                </Select>
              </Row>
            </SettingsCard>
          )}

          {section === "runtime" && (
            <SettingsCard title="Runtime">
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
            <SettingsCard title="About">
              <p className="text-[13px] m-0 mb-2 flex items-center gap-1.5">
                OpenAgents Launcher {launcherVersion}
              </p>
              <p className="text-[13px] m-0">
                <button
                  type="button"
                  className="bg-transparent border-0 p-0 text-(--accent) underline cursor-pointer"
                  onClick={() => {
                    window.api.openExternal("https://docs.openagents.com")
                  }}
                >
                  Documentation
                </button>
              </p>
            </SettingsCard>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="Reset all settings?"
        description="Restores every setting to its default. This cannot be undone."
        confirmLabel="Reset"
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
