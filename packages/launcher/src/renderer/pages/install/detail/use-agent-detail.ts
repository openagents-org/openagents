import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { useAgentsStore } from "@renderer/store/agents"
import { useInstallStore, type InstallJob } from "@renderer/store/install"
import { installErrorMessage, throwIfInstallFailed } from "@renderer/utils/installErrors"
import type {
  AgentUpdateInfo,
  CatalogEntry,
  EnvField,
  HealthCheck,
  InstalledAgentRecord,
} from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

import type { VersionEntry } from "./detail-versions"

interface Changelog {
  versions: VersionEntry[]
  homepage?: string
  latest: string | null
  error?: string
  loading: boolean
}

interface Options {
  entry: CatalogEntry
  onAfterInstall: (entry: CatalogEntry) => void
  showToast: (msg: string, type?: ToastType) => void
}

interface AgentDetailView {
  /**
   * True until this agent's own state has been read. The rail and the status
   * badge answer "is there an update" from it, and neither may guess: the
   * facts arrive together, a few hundred ms in.
   */
  loading: boolean
  envFields: EnvField[]
  envValues: Record<string, string>
  setEnvValues: (next: Record<string, string>) => void
  installed: InstalledAgentRecord | null
  changelog: Changelog
  /** True once at least one agent of this type exists — hides the wizard. */
  hasInstance: boolean
  job: InstallJob | undefined
  currentVersion: string | null
  latestVersion: string | null
  /** Resolved CLI path from the health probe; null until it answers. */
  binaryPath: string | null
  startInstall: (verb: "install" | "update") => Promise<void>
  startUninstall: (wipeEnv: boolean) => Promise<void>
  startRollback: () => Promise<void>
  copyLog: () => Promise<void>
}

/**
 * Everything the detail page reads and does: the IPC fetches on mount, and the
 * install / uninstall / rollback handlers. Kept out of the component so the
 * layout file stays a layout file.
 */
export function useAgentDetail({
  entry,
  onAfterInstall,
  showToast,
}: Options): AgentDetailView {
  const { t } = useTranslation()
  const [envFields, setEnvFields] = useState<EnvField[]>([])
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [installed, setInstalled] = useState<InstalledAgentRecord | null>(null)
  const [update, setUpdate] = useState<AgentUpdateInfo | null>(null)
  const [health, setHealth] = useState<HealthCheck | null>(null)
  const [changelog, setChangelog] = useState<Changelog>({
    versions: [],
    latest: null,
    loading: true,
  })
  /**
   * Which agent the state above actually describes. Not a boolean: the fetch
   * re-runs on the same agent (after an install finishes) and must not blank
   * the rail each time, while switching agents must not show the previous
   * one's answers for a frame.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const setStoreAgents = useAgentsStore((s) => s.setAgents)
  // Read from the shared agents store so other tabs' polling and the wizard's
  // own post-create refresh both flip this reactively — a snapshot taken on
  // mount went stale the moment the wizard created an instance.
  const hasInstance = useAgentsStore((s) =>
    s.agents.some((a) => a.type === entry.name),
  )
  const job = useInstallStore((s) => s.jobs[entry.name])
  const jobPhase = job?.phase
  // Seeded from what the marketplace list already fetched, so arriving from it
  // — the way most people get here — renders the right buttons at once, not a
  // spinner over facts we hold. Only PRESENCE counts: an agent missing
  // from `updates` may be one the background probe has not reached yet, which
  // is not the same as an agent that is up to date.
  const storeInstalled = useInstallStore(
    (s) => s.installed.find((i) => i.name === entry.name) || null,
  )
  const storeUpdate = useInstallStore(
    (s) => s.updates.find((u) => u.name === entry.name) || null,
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [fields, savedEnv, list, updates, change, healthInfo, agents] =
          await Promise.all([
            window.api.getEnvFields(entry.name).catch(() => [] as EnvField[]),
            window.api
              .getAgentEnv(entry.name)
              .catch(() => ({}) as Record<string, string>),
            window.api.getInstalledAgents().catch(() => []),
            window.api.checkAgentUpdates().catch(() => []),
            window.api.getAgentChangelog(entry.name).catch(() => ({
              versions: [] as VersionEntry[],
              homepage: undefined as string | undefined,
              latest: null as string | null,
              error: undefined as string | undefined,
            })),
            entry.installed
              ? window.api.healthCheck(entry.name).catch(() => null)
              : Promise.resolve(null),
            // null, not [] — a failed list must not be mistaken for "no
            // agents exist" (see the store write below).
            window.api.listAgents().catch(() => null),
          ])
        if (cancelled) return
        setEnvFields(fields || [])
        setEnvValues({ ...(savedEnv || {}) })
        setInstalled(list.find((i) => i.name === entry.name) || null)
        setUpdate(updates.find((u) => u.name === entry.name) || null)
        setHealth(healthInfo)
        // Bootstrap the agents store from this fetch so a first visit to the
        // marketplace (before Agents/Dashboard populated it) still resolves
        // `hasInstance` correctly.
        //
        // Only ever on a real answer. Writing the failure fallback here wiped a
        // correct list — and with no global agent polling to repair it, the
        // detail page then offered "Setup wizard" for an agent that already had
        // an instance until the user visited another tab.
        if (agents) setStoreAgents(agents)
        setChangelog({
          versions: change.versions || [],
          homepage: change.homepage,
          latest: change.latest ?? null,
          error: change.error,
          loading: false,
        })
        setLoadedFor(entry.name)
      } catch {
        if (cancelled) return
        setChangelog((s) => ({ ...s, loading: false }))
        // Failed is still answered: what we know is what we have, and holding
        // skeletons forever would be worse than showing it.
        setLoadedFor(entry.name)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [entry.name, entry.installed, jobPhase, setStoreAgents])

  const startInstall = useCallback(
    async (verb: "install" | "update") => {
      useInstallStore.getState().startJob({ agent: entry.name, verb })
      try {
        // The install IPC resolves with { success:false, error } rather than
        // rejecting, so an unchecked await would fall through to the success
        // path — marking the agent installed even when the CLI never landed.
        const result = await window.api.installAgentTypeStreaming(entry.name)
        throwIfInstallFailed(result)
        showToast(
          t("agents.detail.toast.installSuccess", {
            name: entry.label || entry.name,
            action:
              verb === "update"
                ? t("agents.detail.toast.updated")
                : t("agents.detail.toast.installed"),
          }),
          "success",
        )
        onAfterInstall(entry)
      } catch (e: unknown) {
        showToast(
          t("agents.detail.toast.installFailed", {
            verb,
            message: (e as Error).message,
          }),
          "error",
        )
      }
    },
    [entry, onAfterInstall, showToast, t],
  )

  const startUninstall = useCallback(
    async (wipeEnv: boolean) => {
      useInstallStore.getState().startJob({ agent: entry.name, verb: "uninstall" })
      try {
        await window.api.uninstallAgentTypeStreaming(entry.name)
        if (wipeEnv) {
          try {
            await window.api.deleteAgentEnv(entry.name)
          } catch {
            /* non-fatal — the uninstall itself already succeeded */
          }
        }
        // The uninstall only ever removes what the launcher put under
        // ~/.openagents/. A copy the user installed globally survives it and
        // keeps the agent on PATH — so re-probe before claiming anything. A
        // green "Uninstalled" over an agent that is still plainly installed is
        // the single most confusing thing this screen can say, and it is what
        // makes a correct uninstall look like a broken button.
        const name = entry.label || entry.name
        const remaining = await window.api
          .getCatalog(true)
          .then((c) => c.find((e) => e.name === entry.name))
          .catch(() => null)
        if (remaining?.installed) {
          showToast(t("agents.detail.toast.uninstalledButGlobal", { name }), "warning")
        } else {
          showToast(t("agents.detail.toast.uninstalled", { name }), "success")
        }
        onAfterInstall(entry)
      } catch (e: unknown) {
        showToast(
          t("agents.detail.toast.uninstallFailed", { message: installErrorMessage(e) }),
          "error",
        )
      }
    },
    [entry, onAfterInstall, showToast, t],
  )

  const startRollback = useCallback(async () => {
    if (!installed?.history?.length && !installed?.previousVersion) {
      showToast(t("agents.detail.toast.noPreviousVersion"), "warning")
      return
    }
    useInstallStore.getState().startJob({ agent: entry.name, verb: "rollback" })
    try {
      const r = await window.api.rollbackAgentType(entry.name)
      if (r.success) {
        showToast(t("agents.detail.toast.rolledBack", { version: r.version }), "success")
        onAfterInstall(entry)
      } else {
        showToast(r.error || t("agents.detail.toast.rollbackFailedBare"), "error")
      }
    } catch (e: unknown) {
      showToast(
        t("agents.detail.toast.rollbackFailed", { message: installErrorMessage(e) }),
        "error",
      )
    }
  }, [entry, installed, onAfterInstall, showToast, t])

  const copyLog = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(job?.log || "")
      showToast(t("agents.detail.toast.logCopied"), "success")
    } catch {
      showToast(t("agents.detail.toast.logCopyFailed"), "error")
    }
  }, [job?.log, showToast, t])

  const record = installed || storeInstalled
  const latestVersion =
    update?.latest || storeUpdate?.latest || changelog.latest || null

  return {
    // An agent that is not installed has one button, and the catalog already
    // said so. The wait only applies to the installed case, where which button
    // belongs here depends on a version comparison we cannot make yet.
    loading: !!entry.installed && loadedFor !== entry.name && !latestVersion,
    envFields,
    envValues,
    setEnvValues,
    installed: record,
    changelog,
    hasInstance,
    job,
    currentVersion: record?.version || health?.version || null,
    // Where the CLI resolved to. Only interesting for an install outside
    // ~/.openagents/, where it is the difference between "the button is broken"
    // and "there is a second copy over here".
    binaryPath: health?.binary || null,
    latestVersion,
    startInstall,
    startUninstall,
    startRollback,
    copyLog,
  }
}
