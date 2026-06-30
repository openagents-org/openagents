import React, { useCallback, useEffect, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Button } from "../ui/Button"
import { Checkbox } from "../ui/Checkbox"
import { Modal, ModalTitle } from "../ui/Modal"
import AgentIcon from "../AgentIcon"
import { useInstallStore } from "../../store/install"
import { useAgentsStore } from "../../store/agents"
import type {
  Agent,
  AgentUpdateInfo,
  CatalogEntry,
  EnvField,
  HealthCheck,
  InstalledAgentRecord,
} from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { AgentHeader } from "./AgentHeader"
import { AgentInstallActions } from "./AgentInstallActions"
import { AgentReadme } from "./AgentReadme"
import { AgentScreenshots } from "./AgentScreenshots"
import { AgentSystemRequirements, AgentDependencies } from "./AgentDependencies"
import { AgentEnvConfig } from "./AgentEnvConfig"
import { AgentQuickStart } from "./AgentQuickStart"
import { AgentChangelog } from "./AgentChangelog"
import { InstallConfirmModal } from "./InstallConfirmModal"
import { ChannelSelector } from "./ChannelSelector"
import { StagedProgress } from "../install-progress/StagedProgress"
import { useAgentChannel, channelToDistTag } from "../../hooks/useAgentChannel"
import { installErrorMessage, throwIfInstallFailed } from "../../utils/installErrors"
import { isLoginOnlyAgent } from "../../lib/agent-auth"

interface AgentDetailProps {
  entry: CatalogEntry
  onBack: () => void
  onAfterInstall: (entry: CatalogEntry) => void
  onOpenWizard?: (entry: CatalogEntry) => void
  showToast: (msg: string, type?: ToastType) => void
}

interface ChangelogState {
  versions: Array<{ version: string; date?: string }>
  homepage?: string
  latest?: string | null
  error?: string
  loading: boolean
}

/**
 * Detail page orchestrator. Owns the IPC fetches (env_config, installed
 * record, update info, healthCheck, changelog) and the install/uninstall/
 * rollback handlers. Layout-wise it's a single column at narrow widths and
 * a two-column with a sticky right action rail at >=lg widths.
 */
export default function AgentDetail({
  entry,
  onBack,
  onAfterInstall,
  onOpenWizard,
  showToast,
}: AgentDetailProps): React.JSX.Element {
  const { t } = useTranslation()
  const [envFields, setEnvFields] = useState<EnvField[]>([])
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [installed, setInstalled] = useState<InstalledAgentRecord | null>(null)
  const [update, setUpdate] = useState<AgentUpdateInfo | null>(null)
  const [health, setHealth] = useState<HealthCheck | null>(null)
  const [changelog, setChangelog] = useState<ChangelogState>({
    versions: [],
    loading: true,
  })
  // Setup wizard is a first-run affordance — once the user has created at
  // least one agent of this type, env editing lives inline on this page and
  // adding more instances lives on the Agents page, so the wizard button
  // becomes redundant and misleadingly named. Read from the shared agents
  // store so other tabs' polling (Agents/Dashboard) and the wizard's own
  // post-create refresh both flip this reactively — without it, AgentDetail
  // was using a stale snapshot taken on mount and never re-checking.
  const hasInstance = useAgentsStore((s) =>
    s.agents.some((a) => a.type === entry.name),
  )
  const setStoreAgents = useAgentsStore((s) => s.setAgents)
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)
  const [wipeEnvOnUninstall, setWipeEnvOnUninstall] = useState(false)
  // Two-step confirmation before install / update kicks off — matches
  // launcher-legacy's installCatalogItem() flow.
  const [confirmingInstall, setConfirmingInstall] = useState<
    "install" | "update" | null
  >(null)
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
              versions: [] as Array<{ version: string; date?: string }>,
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
        // Bootstrap the agents store from this fetch so a first-visit to the
        // Install tab (before Agents/Dashboard has populated it) still has
        // accurate data for the hasInstance selector.
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
  }, [entry.name, entry.installed, jobPhase])

  // Reset scroll on agent change so a deep dive doesn't inherit scroll state.
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 })
  }, [entry.name])

  // Keep the progress card visible once shown, until the user navigates away.
  // Prevents the card from flashing in and out as the store transitions
  // between phases.
  const [progressSticky, setProgressSticky] = useState(false)
  const isBusy = !!job && job.phase !== "done" && job.phase !== "error"
  useEffect(() => {
    setProgressSticky(false)
  }, [entry.name])
  useEffect(() => {
    if (isBusy) setProgressSticky(true)
  }, [isBusy])
  const showProgress =
    !!job && job.verb !== "uninstall" && (isBusy || progressSticky)

  const currentVersion = installed?.version || health?.version || null
  const latestVersion = update?.latest || changelog.latest || null
  const installedAtLabel = installed?.installedAt
    ? new Date(installed.installedAt).toLocaleString()
    : entry.installed && !installed
      ? t("agents.header.externalInstall")
      : null

  const startInstall = useCallback(
    async (verb: "install" | "update") => {
      useInstallStore.getState().startJob({ agent: entry.name, verb })
      try {
        // Stage.md §2.5 — when the user picked a non-stable channel, route
        // the install through the version-tag IPC so npm pulls from that
        // dist-tag (`@beta`, `@nightly`). Stable goes through the regular
        // pipeline which already follows `@latest`.
        const tag = channelToDistTag(channel)
        // The install IPC resolves with { success:false, error } on failure
        // (it doesn't reject), so an unchecked await would fall through to the
        // success path — marking the agent installed and auto-opening the setup
        // wizard even when the CLI never landed. Surface the failure instead.
        const result = tag
          ? await window.api.installAgentTypeAtVersionStreaming(entry.name, tag)
          : await window.api.installAgentTypeStreaming(entry.name)
        throwIfInstallFailed(result)
        showToast(
          t("agents.detail.toast.installSuccess", {
            name: entry.label || entry.name,
            action: verb === "update" ? t("agents.detail.toast.updated") : t("agents.detail.toast.installed"),
            tag: tag ? ` (${tag})` : "",
          }),
          "success",
        )
        onAfterInstall(entry)
      } catch (e: unknown) {
        showToast(t("agents.detail.toast.installFailed", { verb, message: (e as Error).message }), "error")
      }
    },
    [entry, channel, onAfterInstall, showToast, t],
  )

  const startUninstall = useCallback(async () => {
    setConfirmingUninstall(false)
    const wipeEnv = wipeEnvOnUninstall
    setWipeEnvOnUninstall(false)
    useInstallStore
      .getState()
      .startJob({ agent: entry.name, verb: "uninstall" })
    try {
      await window.api.uninstallAgentTypeStreaming(entry.name)
      if (wipeEnv) {
        try {
          await window.api.deleteAgentEnv(entry.name)
        } catch {
          /* non-fatal — uninstall already succeeded */
        }
      }
      showToast(t("agents.detail.toast.uninstalled", { name: entry.label || entry.name }), "success")
      onAfterInstall(entry)
    } catch (e: unknown) {
      showToast(t("agents.detail.toast.uninstallFailed", { message: installErrorMessage(e) }), "error")
    }
  }, [entry, onAfterInstall, showToast, wipeEnvOnUninstall, t])

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
      showToast(t("agents.detail.toast.rollbackFailed", { message: installErrorMessage(e) }), "error")
    }
  }, [entry, installed, onAfterInstall, showToast, t])

  const copyLog = useCallback(async () => {
    const text = job?.log || ""
    try {
      await navigator.clipboard.writeText(text)
      showToast(t("agents.detail.toast.logCopied"), "success")
    } catch {
      showToast(t("agents.detail.toast.logCopyFailed"), "error")
    }
  }, [job?.log, showToast, t])

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Button size="sm" variant="ghost" onClick={onBack}>
          {t("agents.detail.back")}
        </Button>
      </div>

      {/* Single column. Action buttons live next to the header (top-right)
         rather than in a sticky right rail — keeps the buttons compact and
         lets each section use the full content width. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <AgentHeader
              entry={entry}
              installed={installed}
              currentVersion={currentVersion}
              latestVersion={latestVersion}
              homepage={entry.homepage || changelog.homepage}
              github={entry.github}
              docs={entry.docs}
              installedAtLabel={installedAtLabel}
            />
          </div>
          <div className="md:pt-1 md:max-w-[min(60%,520px)] flex flex-col gap-2 items-stretch md:items-end">
            <AgentInstallActions
              entry={entry}
              installed={installed}
              job={job}
              latestVersion={latestVersion}
              currentVersion={currentVersion}
              onInstall={() => setConfirmingInstall("install")}
              onUpdate={() => setConfirmingInstall("update")}
              onUninstall={() => setConfirmingUninstall(true)}
              onRollback={startRollback}
              onOpenWizard={
                onOpenWizard && !hasInstance && !isLoginOnlyAgent(entry, envFields)
                  ? () => onOpenWizard(entry)
                  : undefined
              }
            />
            <ChannelSelector value={channel} onChange={setChannel} />
          </div>
        </div>

        {showProgress && job && (
          <StagedProgress
            job={job}
            onCopyLog={copyLog}
            onRetry={
              job.phase === "error"
                ? () =>
                    startInstall(job.verb === "update" ? "update" : "install")
                : undefined
            }
          />
        )}

        {/* 描述 */}
        <AgentReadme entry={entry} />

        {/* 截图 / 演示 */}
        <AgentScreenshots
          screenshots={(entry.screenshots || []).filter(Boolean) as string[]}
          demoUrl={entry.demo_url || entry.demo}
          altPrefix={entry.label || entry.name}
        />

        {/* 系统要求 */}
        <AgentSystemRequirements entry={entry} />

        {/* 依赖项 */}
        <AgentDependencies entry={entry} />

        {/* 环境变量配置 (inline, not modal) */}
        <AgentEnvConfig
          agentName={entry.name}
          fields={envFields}
          values={envValues}
          onChange={setEnvValues}
          showToast={showToast}
        />

        {/* 使用入门指南 */}
        <AgentQuickStart entry={entry} showToast={showToast} />

        {/* 版本信息 */}
        <AgentChangelog
          versions={changelog.versions}
          loading={changelog.loading}
          error={changelog.error}
          homepage={changelog.homepage}
          entry={entry}
          currentVersion={currentVersion}
        />
      </div>

      <InstallConfirmModal
        open={!!confirmingInstall}
        verb={confirmingInstall || "install"}
        entry={entry}
        onConfirm={() => {
          const v = confirmingInstall
          setConfirmingInstall(null)
          if (v) startInstall(v)
        }}
        onCancel={() => setConfirmingInstall(null)}
      />

      <Modal
        open={confirmingUninstall}
        onClose={() => {
          setConfirmingUninstall(false)
          setWipeEnvOnUninstall(false)
        }}
      >
        <div className="flex flex-col items-center py-2">
          <AgentIcon type={entry.name} size={40} />
          <ModalTitle className="mt-3 text-center">
            {t("agents.detail.uninstallTitle", { name: entry.label || entry.name })}
          </ModalTitle>
          <p className="hint mt-3 mb-4 text-center">
            <Trans
              i18nKey="agents.detail.uninstallBody"
              values={{ name: entry.label || entry.name }}
              components={{ 1: <strong /> }}
            />
          </p>
          <button
            type="button"
            onClick={() => setWipeEnvOnUninstall((v) => !v)}
            className="flex items-start gap-2.5 w-full mb-5 px-3 py-2.5 rounded-(--radius-sm) border border-(--border) bg-(--bg-input)/40 hover:border-(--border-hover) hover:bg-(--bg-input)/70 transition-colors text-left cursor-pointer"
          >
            <Checkbox
              checked={wipeEnvOnUninstall}
              onCheckedChange={setWipeEnvOnUninstall}
              className="mt-0.5"
            />
            <span className="text-[12px] leading-snug text-(--text-secondary)">
              {t("agents.detail.alsoRemoveEnv")}{" "}
              <span className="text-(--text-tertiary)">
                {t("agents.detail.alsoRemoveEnvHint")}
              </span>
            </span>
          </button>
          <div className="form-actions justify-center mt-0">
            <Button variant="destructive" onClick={startUninstall}>
              {t("agents.detail.uninstall")}
            </Button>
            <Button
              onClick={() => {
                setConfirmingUninstall(false)
                setWipeEnvOnUninstall(false)
              }}
            >
              {t("agents.detail.cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
