import React, { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { ConfirmDialog } from "@renderer/components/ui-kit"
import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import type { ToastType } from "@renderer/hooks/useToast"

import { DetailHeader } from "./components/detail-header"
import { RelatedSettings } from "./components/related-settings"
import { ResetSummary } from "./components/reset-summary"
import { SettingsOverview } from "./components/settings-overview"
import { RELATED, SECTIONS, type SectionId } from "./section-config"
import { useLauncherUpdater } from "./use-launcher-updater"
import { useSectionSummaries } from "./use-section-summaries"
import { useSettingsIO } from "./use-settings-io"
import { useSettingsState } from "./use-settings-state"
import { useSystemInfo } from "./use-system-info"
import { GeneralSection } from "./sections/general-section"
import { AppearanceSection } from "./sections/appearance-section"
import { AgentsSection } from "./sections/agents-section"
import { NotificationsSection } from "./sections/notifications-section"
import { NetworkSection } from "./sections/network-section"
import { DataSection } from "./sections/data-section"
import { LanguageSection } from "./sections/language-section"
import { UpdatesSection } from "./sections/updates-section"
import { RuntimeSection } from "./sections/runtime-section"
import { AboutSection } from "./sections/about-section"

// Which lines each confirmation spells out; the copy lives under the matching
// `settings.*Dialog.affected/kept` i18n prefix.
const SETTINGS_RESET_AFFECTED = ["startup", "agents", "network", "updates"]
const SETTINGS_RESET_KEPT = ["agents", "workspaces", "prefs"]
const LOCAL_RESET_AFFECTED = ["appearance", "layout", "history", "marketplace"]
const LOCAL_RESET_KEPT = ["settings", "language", "workspaces"]

interface SettingsProps {
  showToast: (msg: string, type?: ToastType) => void
}

export default function Settings({ showToast }: SettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const {
    values,
    update,
    setLocal,
    persist,
    paths,
    runtimeInfo,
    launcherVersion,
    loadSettings,
  } = useSettingsState()
  // null is the overview grid; a section id is that module's own controls.
  const [section, setSection] = useState<SectionId | null>(null)
  const [search, setSearch] = useState("")

  const agents = useAgentsStore((s) => s.agents)

  // Deep-link from elsewhere in the app (currently the update banner's "view
  // progress" / "update now"), which needs to open a specific module rather
  // than the overview. Keyed off the signal too, so re-requesting a section the
  // user has since navigated away from still re-opens it.
  const { deepLinkSection, deepLinkSignal } = useUiStore(
    useShallow((s) => ({
      deepLinkSection: s.settingsSection,
      deepLinkSignal: s.settingsSectionSignal,
    })),
  )
  useEffect(() => {
    if (!deepLinkSection) return
    if (SECTIONS.some((s) => s.id === deepLinkSection)) {
      setSection(deepLinkSection as SectionId)
    }
  }, [deepLinkSection, deepLinkSignal])

  // Publish what is on screen so the rest of the app can defer to it — the
  // update banner hides while Updates is open. Cleared on the way out, which
  // covers both closing the module and leaving Settings altogether.
  const setVisibleSection = useUiStore((s) => s.setVisibleSettingsSection)
  useEffect(() => {
    setVisibleSection(section)
    return () => setVisibleSection(null)
  }, [section, setVisibleSection])

  const {
    updater,
    check: checkUpdate,
    download: downloadUpdate,
    install: installUpdate,
  } = useLauncherUpdater(section === "updates", showToast)
  const {
    exportSettings,
    importSettings,
    resetOpen,
    openReset,
    closeReset,
    resetting,
    performReset,
    clearingCache,
    clearCache,
    localResetOpen,
    openLocalReset,
    closeLocalReset,
    performLocalReset,
  } = useSettingsIO(loadSettings, showToast)

  // Runtime and About both read the host snapshot; polling stays scoped to them.
  const systemInfo = useSystemInfo(section === "runtime" || section === "about")

  const summaries = useSectionSummaries({
    values,
    paths,
    runtimeInfo,
    launcherVersion,
    agentCount: agents.length,
  })

  return (
    <section className="flex h-full flex-col">
      {section === null ? (
        <SettingsOverview
          summaries={summaries}
          search={search}
          onSearchChange={setSearch}
          onSelect={setSection}
          onReset={openReset}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-9 pt-5 pb-6">
          <DetailHeader section={section} onBack={() => setSection(null)} />

          {section === "general" && (
            <GeneralSection values={values} update={update} />
          )}
          {section === "appearance" && <AppearanceSection />}
          {section === "agents" && (
            <AgentsSection values={values} update={update} agents={agents} />
          )}
          {section === "notifications" && <NotificationsSection />}
          {section === "network" && (
            <NetworkSection
              values={values}
              update={update}
              setLocal={setLocal}
              persist={persist}
            />
          )}
          {section === "data" && (
            <DataSection
              paths={paths}
              exportSettings={exportSettings}
              importSettings={importSettings}
              openReset={openReset}
              clearingCache={clearingCache}
              clearCache={clearCache}
              openLocalReset={openLocalReset}
            />
          )}
          {section === "language" && <LanguageSection />}
          {section === "updates" && (
            <UpdatesSection
              values={values}
              update={update}
              launcherVersion={launcherVersion}
              updater={updater}
              checkUpdate={checkUpdate}
              downloadUpdate={downloadUpdate}
              installUpdate={installUpdate}
            />
          )}
          {section === "runtime" && (
            <RuntimeSection
              runtimeInfo={runtimeInfo}
              systemInfo={systemInfo}
              paths={paths}
              launcherVersion={launcherVersion}
              showToast={showToast}
            />
          )}
          {section === "about" && (
            <AboutSection
              launcherVersion={launcherVersion}
              runtimeInfo={runtimeInfo}
              systemInfo={systemInfo}
            />
          )}

          <RelatedSettings ids={RELATED[section] ?? []} onSelect={setSection} />
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        title={t("settings.resetDialog.title")}
        description={t("settings.resetDialog.description")}
        confirmLabel={t("settings.resetDialog.confirm")}
        destructive
        busy={resetting}
        onCancel={closeReset}
        onConfirm={performReset}
      >
        <ResetSummary
          prefix="settings.resetDialog"
          affected={SETTINGS_RESET_AFFECTED}
          kept={SETTINGS_RESET_KEPT}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={localResetOpen}
        title={t("settings.localResetDialog.title")}
        description={t("settings.localResetDialog.description")}
        confirmLabel={t("settings.localResetDialog.confirm")}
        destructive
        onCancel={closeLocalReset}
        onConfirm={performLocalReset}
      >
        <ResetSummary
          prefix="settings.localResetDialog"
          affected={LOCAL_RESET_AFFECTED}
          kept={LOCAL_RESET_KEPT}
        />
      </ConfirmDialog>
    </section>
  )
}
