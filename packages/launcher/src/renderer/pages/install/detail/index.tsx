import React, { useEffect, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { isLoginOnlyAgent } from "@renderer/lib/agent-auth"
import type { CatalogEntry } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

import { isJobBusy } from "../entry-meta"
import { DetailConfig } from "./detail-config"
import { DetailHeader } from "./detail-header"
import { DetailOverview } from "./detail-overview"
import { DetailProgress } from "./detail-progress"
import { DetailQuickStart } from "./detail-quick-start"
import { DetailRail } from "./detail-rail"
import { DetailScreenshots } from "./detail-screenshots"
import { DetailSection } from "./detail-section"
import { DetailVersions, MAX_VERSIONS } from "./detail-versions"
import { InstallConfirmDialog } from "./install-confirm-dialog"
import { UninstallDialog } from "./uninstall-dialog"
import { useAgentDetail } from "./use-agent-detail"

interface Props {
  entry: CatalogEntry
  onBack: () => void
  onAfterInstall: (entry: CatalogEntry) => void
  onOpenWizard?: (entry: CatalogEntry) => void
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Agent detail page. One document in the main column — overview, progress,
 * configuration, first commands, version history — with every action gathered
 * into the right rail.
 */
export default function AgentDetail({
  entry,
  onBack,
  onAfterInstall,
  onOpenWizard,
  showToast,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const detail = useAgentDetail({ entry, onAfterInstall, showToast })
  const [confirmInstall, setConfirmInstall] = useState<"install" | "update" | null>(
    null,
  )
  const [confirmUninstall, setConfirmUninstall] = useState(false)

  // Reset scroll on agent change so a deep dive doesn't inherit scroll state.
  // The document column owns the scrollbar now, so it is the thing to reset —
  // the page around it never moves.
  const documentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Assigning scrollTop rather than calling scrollTo(): the jump should be
    // instant anyway, and this is the one of the two that jsdom implements.
    if (documentRef.current) documentRef.current.scrollTop = 0
  }, [entry.name])

  // Keep the progress block on screen once it has appeared, until the user
  // navigates away — otherwise it flashes in and out as phases transition.
  const [progressSticky, setProgressSticky] = useState(false)
  const busy = isJobBusy(detail.job)
  useEffect(() => setProgressSticky(false), [entry.name])
  useEffect(() => {
    if (busy) setProgressSticky(true)
  }, [busy])
  const showProgress =
    !!detail.job && detail.job.verb !== "uninstall" && (busy || progressSticky)

  const installedAtLabel = detail.installed?.installedAt
    ? new Date(detail.installed.installedAt).toLocaleString()
    : entry.installed && !detail.installed
      ? t("agents.header.externalInstall")
      : null

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* Pinned: which agent you are looking at, and the way back out. Only
          the document column below scrolls. */}
      <div className="mx-auto w-full max-w-7xl shrink-0 px-9 pt-5">
        <Button size="sm" variant="ghost" className="mb-3 -ml-2" onClick={onBack}>
          <ArrowLeft />
          {t("agents.detail.back")}
        </Button>

        <DetailHeader
          entry={entry}
          currentVersion={detail.currentVersion}
          latestVersion={detail.latestVersion}
          homepage={entry.homepage || detail.changelog.homepage}
          github={entry.github}
          docs={entry.docs}
          installedAtLabel={installedAtLabel}
        />
      </div>

      {/* Below `lg` there is no room for two columns, so the whole area
          becomes one scroller instead. */}
      <div className="mx-auto flex w-full min-h-0 max-w-7xl flex-1 flex-col gap-6 overflow-y-auto px-9 py-6 lg:flex-row lg:gap-8 lg:overflow-hidden">
        <div
          ref={documentRef}
          className="flex min-w-0 flex-col gap-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1"
        >
          <DetailSection title={t("agents.readme.overview")}>
            <DetailOverview entry={entry} />
            <DetailScreenshots
              screenshots={(entry.screenshots || []).filter(Boolean) as string[]}
              demoUrl={entry.demo_url || entry.demo}
              altPrefix={entry.label || entry.name}
            />
          </DetailSection>

          {showProgress && detail.job && (
            <DetailProgress
              job={detail.job}
              onCopyLog={detail.copyLog}
              onRetry={
                detail.job.phase === "error"
                  ? () =>
                      detail.startInstall(
                        detail.job?.verb === "update" ? "update" : "install",
                      )
                  : undefined
              }
            />
          )}

          {detail.envFields.length > 0 && (
            <DetailSection title={t("agents.envConfig.title")}>
              <DetailConfig
                agentName={entry.name}
                fields={detail.envFields}
                values={detail.envValues}
                onChange={detail.setEnvValues}
                showToast={showToast}
              />
            </DetailSection>
          )}

          <DetailSection title={t("agents.quickStart.title")}>
            <DetailQuickStart entry={entry} showToast={showToast} />
          </DetailSection>

          <DetailSection
            title={t("agents.changelog.title")}
            action={
              detail.changelog.versions.length > 0 && (
                <span className="text-2xs text-muted-foreground">
                  {t("agents.changelog.recent", {
                    count: Math.min(detail.changelog.versions.length, MAX_VERSIONS),
                  })}
                </span>
              )
            }
          >
            <DetailVersions
              versions={detail.changelog.versions}
              loading={detail.changelog.loading}
              error={detail.changelog.error}
              entry={entry}
              currentVersion={detail.currentVersion}
            />
          </DetailSection>
        </div>

        <DetailRail
          className="lg:min-h-0 lg:w-72 lg:shrink-0 lg:overflow-y-auto"
          entry={entry}
          installed={detail.installed}
          job={detail.job}
          currentVersion={detail.currentVersion}
          latestVersion={detail.latestVersion}
          channel={detail.channel}
          onChannelChange={detail.setChannel}
          onInstall={() => setConfirmInstall("install")}
          onUpdate={() => setConfirmInstall("update")}
          onUninstall={() => setConfirmUninstall(true)}
          onRollback={detail.startRollback}
          onOpenWizard={
            onOpenWizard &&
            !detail.hasInstance &&
            !isLoginOnlyAgent(entry, detail.envFields)
              ? () => onOpenWizard(entry)
              : undefined
          }
        />
      </div>

      <InstallConfirmDialog
        open={!!confirmInstall}
        verb={confirmInstall || "install"}
        entry={entry}
        onConfirm={() => {
          const verb = confirmInstall
          setConfirmInstall(null)
          if (verb) void detail.startInstall(verb)
        }}
        onCancel={() => setConfirmInstall(null)}
      />

      <UninstallDialog
        entry={confirmUninstall ? entry : null}
        onConfirm={(wipeEnv) => {
          setConfirmUninstall(false)
          void detail.startUninstall(wipeEnv)
        }}
        onCancel={() => setConfirmUninstall(false)}
      />
    </section>
  )
}
