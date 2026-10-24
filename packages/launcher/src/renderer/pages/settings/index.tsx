import React, { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { ConfirmDialog } from "@renderer/components/ui-kit"
import { useUiStore } from "@renderer/store/ui"
import type { ToastType } from "@renderer/hooks/useToast"

import { DetailHeader } from "./components/detail-header"
import { SettingsNav } from "./components/settings-nav"
import { ResetSummary } from "./components/reset-summary"
import { DEFAULT_SECTION, SECTIONS, type SectionId } from "./section-config"
import { useLauncherUpdater } from "./use-launcher-updater"
import { useSettingsIO } from "./use-settings-io"
import { useSettingsState } from "./use-settings-state"
import { useSystemInfo } from "./use-system-info"
import { GeneralSection } from "./sections/general-section"
import { AppearanceSection } from "./sections/appearance-section"
import { NotificationsSection } from "./sections/notifications-section"
import { NetworkSection } from "./sections/network-section"
import { DataSection } from "./sections/data-section"
import { LanguageSection } from "./sections/language-section"
import { UpdatesSection } from "./sections/updates-section"
import { RuntimeSection } from "./sections/runtime-section"
import { AboutSection } from "./sections/about-section"
import Logs from "../logs"

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
  // Settings opens straight on a module; the menu beside it is the way around.
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION)

  // Deep-link from elsewhere in the app (currently the update banner's "view
  // progress" / "update now"), which needs to open a specific module rather
  // than the first one. Keyed off the signal too, so re-requesting a section the
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

  return (
    <section className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <SettingsNav current={section} onSelect={setSection} />
        {section === "logs" ? (
          // The log viewer brings its own header, filters and table, laid out
          // to fill the height, so it takes the pane as it is.
          <div className="flex min-w-0 flex-1 flex-col">
            <Logs showToast={showToast} />
          </div>
        ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The header scrolls away with the module: the nav beside it already
              says where the user is, so pinning it only costs room. */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            <DetailHeader section={section} />
            <div className="px-9 pt-4">
              {section === "general" && (
                <GeneralSection values={values} update={update} />
              )}
              {section === "appearance" && <AppearanceSection />}
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
            </div>
          </div>
        </div>
        )}
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
