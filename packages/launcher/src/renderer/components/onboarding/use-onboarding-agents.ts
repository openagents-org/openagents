import { useCallback, useEffect, useMemo, useState } from "react"

import type { ToastType } from "@renderer/hooks/useToast"
import { useInstallStore } from "@renderer/store/install"
import type { OnboardingAgent } from "@renderer/types"
import { throwIfInstallFailed } from "@renderer/utils/installErrors"

import { SELECTED_AGENT_KEY } from "./onboarding-shared"

export interface OnboardingAgentsApi {
  agents: OnboardingAgent[]
  agentsLoading: boolean
  /** `agents` narrowed by the search box and the installed-only toggle. */
  visibleAgents: OnboardingAgent[]
  search: string
  setSearch: (v: string) => void
  installedOnly: boolean
  setInstalledOnly: (v: boolean) => void
  selectedAgent: string
  setSelectedAgent: (v: string) => void
  selectedEntry: OnboardingAgent | null
  installing: boolean
  installPhase: string | null
  installDetail: string | null
  reload: () => void
  installSelected: () => Promise<void>
}

/**
 * The agent catalog behind the picker: loading (with retry-until-ready),
 * filtering, selection, and installing the selected agent.
 */
export function useOnboardingAgents({
  open,
  showToast,
  onInstalled,
}: {
  open: boolean
  showToast: (msg: string, type?: ToastType) => void
  /** Called once the selected agent is on disk — advances the wizard. */
  onInstalled: () => void
}): OnboardingAgentsApi {
  const [agents, setAgents] = useState<OnboardingAgent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [installedOnly, setInstalledOnly] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_AGENT_KEY) || ""
    } catch {
      return ""
    }
  })
  const [installing, setInstalling] = useState(false)

  // Live install progress for the selected agent, mirrored from the global
  // install:progress IPC stream by useInstallProgress (mounted at App root).
  // Keyed by agent TYPE, which is exactly selectedAgent.
  const installJob = useInstallStore((s) =>
    selectedAgent ? s.jobs[selectedAgent] || null : null,
  )

  const selectedEntry = useMemo(
    () => agents.find((a) => a.name === selectedAgent) || null,
    [agents, selectedAgent],
  )

  useEffect(() => {
    if (!selectedAgent) return
    try {
      localStorage.setItem(SELECTED_AGENT_KEY, selectedAgent)
    } catch {}
  }, [selectedAgent])

  const loadAgents = useCallback(async (): Promise<OnboardingAgent[]> => {
    setAgentsLoading(true)
    try {
      const list = await window.api.getOnboardingAgents()
      setAgents(list)
      return list
    } catch {
      return []
    } finally {
      setAgentsLoading(false)
    }
  }, [])

  // getOnboardingAgents returns [] until the agent-launcher core finishes
  // installing (common on first launch / slow Windows AV). Poll until the
  // runnable set appears so the picker never strands the user on an empty
  // state. Only runnable agents are returned, so whatever shows up is safe to
  // pick — no more "Agent not found" from choosing an unsupported runtime.
  //
  // This runs from the very first step, not just the picker: a returning user
  // can relaunch straight into a resumed step whose content derives from this
  // list (a resumed Configure step would otherwise sit on "Loading
  // configuration…" forever). Skip once loaded.
  useEffect(() => {
    if (!open || agents.length > 0) return
    let cancelled = false
    let attempt = 0
    const run = async (): Promise<void> => {
      while (!cancelled && attempt < 10) {
        const list = await loadAgents()
        if (cancelled) return
        if (list.length > 0) return
        attempt += 1
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, agents.length, loadAgents])

  const visibleAgents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return agents.filter((c) => {
      if (installedOnly && !c.installed) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        (c.label || "").toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q)
      )
    })
  }, [agents, search, installedOnly])

  const installSelected = useCallback(async (): Promise<void> => {
    if (!selectedEntry) return
    if (selectedEntry.installed) {
      onInstalled()
      return
    }
    setInstalling(true)
    const type = selectedEntry.name
    let settled = false
    // First-run installs are slow (npm + sometimes a portable Node download) and
    // can run for several minutes. In rare cases the streaming promise stalls
    // even after npm has finished writing files — leaving the user stuck on a
    // spinner forever (closing/reopening the launcher then shows it installed).
    // Guard against that with a watchdog that polls the real on-disk install
    // state and lets us advance the moment the agent is actually installed. The
    // 30s grace period keeps it from racing a partial install to a false
    // positive during the normal (promise resolves) path.
    const watchdog = new Promise<void>((resolve) => {
      const startedAt = Date.now()
      const poll = async (): Promise<void> => {
        if (settled) return resolve()
        if (Date.now() - startedAt > 30_000) {
          try {
            const r = await window.api.checkAgentType(type)
            if (r?.installed) return resolve()
          } catch {}
        }
        setTimeout(() => void poll(), 5000)
      }
      setTimeout(() => void poll(), 5000)
    })
    try {
      // The install IPC resolves with { success:false, error } on failure (it
      // doesn't reject), so without this check a failed install would fall
      // through to onInstalled() — advancing into the configure step with an
      // agent whose CLI never installed. The watchdog branch resolves to
      // undefined, which throwIfInstallFailed treats as success.
      const result = await Promise.race([
        window.api.installAgentTypeStreaming(type),
        watchdog,
      ])
      settled = true
      throwIfInstallFailed(result)
      await loadAgents()
      onInstalled()
    } catch (e) {
      settled = true
      showToast((e as Error).message, "error")
    } finally {
      setInstalling(false)
    }
  }, [selectedEntry, loadAgents, onInstalled, showToast])

  return {
    agents,
    agentsLoading,
    visibleAgents,
    search,
    setSearch,
    installedOnly,
    setInstalledOnly,
    selectedAgent,
    setSelectedAgent,
    selectedEntry,
    installing,
    installPhase: installJob?.phase ?? null,
    installDetail: installJob?.detail ?? null,
    reload: () => void loadAgents(),
    installSelected,
  }
}
