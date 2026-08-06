import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { useAgentsStore } from "@renderer/store/agents"
import { useInstallStore, type InstallJob } from "@renderer/store/install"
import {
  useAgentChannel,
  channelToDistTag,
  type UpdateChannel,
} from "@renderer/hooks/useAgentChannel"
import { installErrorMessage, throwIfInstallFailed } from "@renderer/utils/installErrors"
import type {
  Agent,
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
  envFields: EnvField[]
  envValues: Record<string, string>
  setEnvValues: (next: Record<string, string>) => void
  installed: InstalledAgentRecord | null
  changelog: Changelog
  /** True once at least one agent of this type exists — hides the wizard. */
  hasInstance: boolean
  channel: UpdateChannel
  setChannel: (next: UpdateChannel) => void
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

  const setStoreAgents = useAgentsStore((s) => s.setAgents)
  // Read from the shared agents store so other tabs' polling and the wizard's
  // own post-create refresh both flip this reactively — a snapshot taken on
  // mount went stale the moment the wizard created an instance.
  const hasInstance = useAgentsStore((s) =>
    s.agents.some((a) => a.type === entry.name),
  )
  const { channel, setChannel } = useAgentChannel(entry.name)
  const job = useInstallStore((s) => s.jobs[entry.name])
  const jobPhase = job?.phase

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
            window.api.listAgents().catch(() => [] as Agent[]),
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
        setStoreAgents(agents)
        setChangelog({
          versions: change.versions || [],
          homepage: change.homepage,
          latest: change.latest ?? null,
          error: change.error,
          loading: false,
        })
      } catch {
        if (!cancelled) setChangelog((s) => ({ ...s, loading: false }))
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
        // A non-stable channel routes through the version-tag IPC so npm pulls
        // that dist-tag; stable uses the regular pipeline, which pins @latest
        // itself for npm-packaged agents.
        const tag = channelToDistTag(channel)
        // The install IPC resolves with { success:false, error } rather than
        // rejecting, so an unchecked await would fall through to the success
        // path — marking the agent installed even when the CLI never landed.
        const result = tag
          ? await window.api.installAgentTypeAtVersionStreaming(entry.name, tag)
          : await window.api.installAgentTypeStreaming(entry.name)
        throwIfInstallFailed(result)
        showToast(
          t("agents.detail.toast.installSuccess", {
            name: entry.label || entry.name,
            action:
              verb === "update"
                ? t("agents.detail.toast.updated")
                : t("agents.detail.toast.installed"),
            tag: tag ? ` (${tag})` : "",
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
    [entry, channel, onAfterInstall, showToast, t],
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

  return {
    envFields,
    envValues,
    setEnvValues,
    installed,
    changelog,
    hasInstance,
    channel,
    setChannel,
    job,
    currentVersion: installed?.version || health?.version || null,
    // Where the CLI resolved to. Only interesting for an install outside
    // ~/.openagents/, where it is the difference between "the button is broken"
    // and "there is a second copy over here".
    binaryPath: health?.binary || null,
    latestVersion: update?.latest || changelog.latest || null,
    startInstall,
    startUninstall,
    startRollback,
    copyLog,
  }
}
