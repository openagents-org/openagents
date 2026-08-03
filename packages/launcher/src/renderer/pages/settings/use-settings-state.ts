import { useCallback, useEffect, useRef, useState } from "react"

import type { RuntimeInfo } from "@renderer/types"

/** Every persisted preference this page edits, keyed by its settings.json key. */
export interface SettingsValues {
  startOnBoot: boolean
  minimizeToTray: boolean
  autoUpdate: boolean
  gpuAcceleration: boolean
  /** Tab to land on at launch, or "last" for whichever was open on exit. */
  startupPage: string
  agentAutoStart: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
  workspaceEndpoint: string
  downloadRegion: string
}

const DEFAULTS: SettingsValues = {
  startOnBoot: false,
  // Default on: closing the window hides to tray unless the user opts out.
  minimizeToTray: true,
  autoUpdate: true,
  gpuAcceleration: true,
  startupPage: "dashboard",
  agentAutoStart: false,
  httpProxy: "",
  httpsProxy: "",
  noProxy: "",
  workspaceEndpoint: "",
  downloadRegion: "auto",
}

/** Setter shared by every section: one key, one persisted write. */
export type Update = <K extends keyof SettingsValues>(
  key: K,
  value: SettingsValues[K],
) => void

export interface SettingsPaths {
  userData?: string
  logs?: string
  agents?: string
  env?: string
  [k: string]: string | undefined
}

/** Runtime panel re-reads on this interval while Settings is mounted. */
const RUNTIME_POLL_MS = 8000

interface SettingsState {
  values: SettingsValues
  /** Writes to settings.json and mirrors it locally in one step. */
  update: Update
  /** Local-only edit, for text fields that persist on blur instead. */
  setLocal: Update
  /** Flushes one locally-edited key to settings.json. */
  persist: (key: keyof SettingsValues) => void
  paths: SettingsPaths
  runtimeInfo: RuntimeInfo | null
  launcherVersion: string
  loadSettings: () => Promise<void>
}

/**
 * Owns the persisted preference values plus the read-only panels (paths,
 * runtime, version).
 *
 * `update` exists because every control previously had to call its own setter
 * *and* `window.api.setSetting` with a matching key — two places to keep in
 * sync per preference, and the bug surface if they drifted.
 */
export function useSettingsState(): SettingsState {
  const [values, setValues] = useState<SettingsValues>(DEFAULTS)
  const [paths, setPaths] = useState<SettingsPaths>({})
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [launcherVersion, setLauncherVersion] = useState("--")
  const mounted = useRef(true)

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
      setValues({
        startOnBoot: !!all.startOnBoot,
        minimizeToTray: all.minimizeToTray !== false,
        autoUpdate: all.autoUpdate !== false,
        gpuAcceleration: all.gpuAcceleration !== false,
        startupPage: (all.startupPage as string) || "dashboard",
        agentAutoStart: !!all.agentAutoStart,
        httpProxy: (all.httpProxy as string) || "",
        httpsProxy: (all.httpsProxy as string) || "",
        noProxy: (all.noProxy as string) || "",
        workspaceEndpoint: (all.workspaceEndpoint as string) || "",
        downloadRegion: (all.downloadRegion as string) || "auto",
      })
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
    const id = setInterval(loadRuntime, RUNTIME_POLL_MS)
    return () => clearInterval(id)
  }, [loadSettings, loadPaths, loadRuntime, loadLauncherVersion])

  // Text fields persist on blur, so `persist` needs the latest value without
  // re-creating the callback on every keystroke.
  const latest = useRef(values)
  latest.current = values

  const setLocal = useCallback(
    <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void => {
      setValues((v) => ({ ...v, [key]: value }))
    },
    [],
  )

  const update = useCallback(
    <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void => {
      setLocal(key, value)
      void window.api.setSetting(key, value)
    },
    [setLocal],
  )

  const persist = useCallback((key: keyof SettingsValues): void => {
    void window.api.setSetting(key, latest.current[key])
  }, [])

  return {
    values,
    update,
    setLocal,
    persist,
    paths,
    runtimeInfo,
    launcherVersion,
    loadSettings,
  }
}
