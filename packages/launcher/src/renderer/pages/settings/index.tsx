import React, { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import type { ToastType } from "@renderer/hooks/useToast"

import { SettingsNav } from "./components/settings-nav"
import { SECTIONS, type SectionId } from "./section-config"
import { useLauncherUpdater } from "./use-launcher-updater"
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
  const [section, setSection] = useState<SectionId>("general")
  const [search, setSearch] = useState("")

  const agents = useAgentsStore((s) => s.agents)

  // Deep-link from elsewhere in the app (currently the update banner's "view
  // progress" / "update now"), which needs to land on a specific section rather
  // than the default General. Keyed off the signal too, so re-requesting a
  // section the user has since navigated away from still re-selects it.
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
  } = useSettingsIO(loadSettings, showToast)

  // Runtime and About both read the host snapshot; polling stays scoped to them.
  const systemInfo = useSystemInfo(section === "runtime" || section === "about")

  return (
    <section className="flex h-full flex-col">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <div className="flex min-h-0 flex-1 gap-6 px-9 py-6">
        <SettingsNav
          section={section}
          onSelect={setSection}
          search={search}
          onSearchChange={setSearch}
        />

        <div className="min-w-0 flex-1 overflow-y-auto pr-2 pb-4">
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
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title={t("settings.resetDialog.title")}
        description={t("settings.resetDialog.description")}
        confirmLabel={t("settings.resetDialog.confirm")}
        destructive
        busy={resetting}
        onCancel={closeReset}
        onConfirm={performReset}
      />
    </section>
  )
}
