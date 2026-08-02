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
import { useTranslation } from "react-i18next"
import { SUPPORTED_LANGUAGES, changeLanguage, type LanguageCode } from "../../i18n"
import { PageHeader } from "../../components/layout/page-header"
import { Switch } from "../../components/ui/switch"
import { SettingsCard, Row } from "./components/settings-card"
import { LauncherUpdate } from "./components/launcher-update"
import { useLauncherUpdater } from "./use-launcher-updater"
import { useSettingsIO } from "./use-settings-io"
import { useSettingsState } from "./use-settings-state"
import { SECTIONS, type SectionId } from "./section-config"
import { GeneralSections } from "./sections/general-sections"
import { AgentSections } from "./sections/agent-sections"
import { SystemSections } from "./sections/system-sections"
import { Separator } from "../../components/ui/separator"
import { Input } from "../../components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select"
import { Button } from "../../components/ui/button"
import { ConfirmDialog } from "../../components/ui-kit"
import { useThemeStore, type ThemeMode } from "../../store/theme"
import { useAgentsStore } from "../../store/agents"
import { useNotificationsStore } from "../../store/notifications"
import { useUiStore } from "../../store/ui"
import type { RuntimeInfo, UpdaterState } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"

interface SettingsProps {
  showToast: (msg: string, type?: ToastType) => void
}




export default function Settings({ showToast }: SettingsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
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






  // Deep-link from elsewhere in the app (currently the update banner's "view
  // progress" / "update now"), which needs to land on a specific section rather
  // than the default General. Keyed off the signal too, so re-requesting a
  // section the user has since navigated away from still re-selects it.
  const deepLinkSection = useUiStore((s) => s.settingsSection)
  const deepLinkSignal = useUiStore((s) => s.settingsSectionSignal)
  useEffect(() => {
    if (!deepLinkSection) return
    if (SECTIONS.some((s) => s.id === deepLinkSection)) {
      setSection(deepLinkSection as SectionId)
    }
  }, [deepLinkSection, deepLinkSignal])


  const { updater, check: checkUpdate, download: downloadUpdate, install: installUpdate } =
    useLauncherUpdater(section === "updates", showToast)
  const {
    exportSettings,
    importSettings,
    resetOpen,
    openReset: resetSettings,
    closeReset,
    resetting,
    performReset,
  } = useSettingsIO(loadSettings, showToast)

  const visibleSections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.filter((s) => t(`settings.sections.${s.id}`).toLowerCase().includes(q))
  }, [search, t])

  const runtimeRows = useMemo<Array<{ label: string; value: string; color?: string }>>(() => {
    if (!runtimeInfo) {
      return [
        { label: t("settings.runtime.nodejs"), value: t("common.checking") },
        { label: t("settings.runtime.npm"), value: t("common.checking") },
        { label: t("settings.runtime.coreLibrary"), value: t("common.checking") },
        { label: t("settings.runtime.latestAvailable"), value: t("common.checking") },
      ]
    }
    const upToDate =
      !!runtimeInfo.latestVersion &&
      runtimeInfo.coreVersion === runtimeInfo.latestVersion
    return [
      {
        label: t("settings.runtime.nodejs"),
        value: runtimeInfo.nodeVersion || t("common.notInstalled"),
        color: runtimeInfo.nodeVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: t("settings.runtime.npm"),
        value: runtimeInfo.npmVersion ? `v${runtimeInfo.npmVersion}` : t("common.notInstalled"),
        color: runtimeInfo.npmVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: t("settings.runtime.coreLibrary"),
        value: runtimeInfo.coreVersion ? `v${runtimeInfo.coreVersion}` : t("common.notInstalled"),
        color: runtimeInfo.coreVersion ? "var(--success-text)" : "var(--danger-text)",
      },
      {
        label: t("settings.runtime.latestAvailable"),
        value: runtimeInfo.latestVersion
          ? `v${runtimeInfo.latestVersion}${upToDate ? t("settings.runtime.upToDateSuffix") : t("settings.runtime.updateAvailableSuffix")}`
          : t("settings.runtime.unableToCheck"),
        color: runtimeInfo.latestVersion
          ? upToDate
            ? "var(--success-text)"
            : "var(--warning-text)"
          : undefined,
      },
    ]
  }, [runtimeInfo, t])

  const agentTypes = useMemo(() => {
    const set = new Set<string>()
    for (const a of agents) if (a.type) set.add(a.type)
    return Array.from(set).sort()
  }, [agents])

  return (
    <section className="flex flex-col h-full">
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={importSettings} title={t("common.import")}>
              <ArrowUpFromLine className="w-3 h-3" />
              {t("common.import")}
            </Button>
            <Button size="sm" variant="outline" onClick={exportSettings} title={t("common.export")}>
              <ArrowDownToLine className="w-3 h-3" />
              {t("common.export")}
            </Button>
            <Button size="sm" variant="destructive-ghost" onClick={resetSettings}>
              <RotateCcw className="w-3 h-3" />
              {t("common.reset")}
            </Button>
          </>
        }
      />

      <div className="flex flex-1 min-h-0 gap-5 px-9 py-6">
        <aside className="w-50 shrink-0">
          <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-sm bg-(--bg-input) text-2xs">
            <Search className="w-3 h-3 text-(--text-tertiary)" />
            <input
              placeholder={t("settings.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent border-0 outline-none flex-1 text-xs"
            />
          </div>
          <ul className="m-0 p-0 list-none">
            {visibleSections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-left text-xs border-0 cursor-pointer mb-px",
                    section === s.id
                      ? "bg-(--accent) text-white"
                      : "bg-transparent text-(--text-secondary) hover:bg-(--bg-input)",
                  )}
                >
                  <span className={section === s.id ? "" : "opacity-70"}>{s.icon}</span>
                  {t(`settings.sections.${s.id}`)}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto pr-2">
          <GeneralSections
            section={section}
            values={values}
            update={update}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
          />
          <AgentSections
            section={section}
            values={values}
            update={update}
            setLocal={setLocal}
            persist={persist}
            agents={agents}
            agentTypes={agentTypes}
            notifPrefs={notifPrefs}
            setNotifPrefs={setNotifPrefs}
          />
          <SystemSections
            section={section}
            values={values}
            update={update}
            paths={paths}
            runtimeRows={runtimeRows}
            launcherVersion={launcherVersion}
            updater={updater}
            checkUpdate={checkUpdate}
            downloadUpdate={downloadUpdate}
            installUpdate={installUpdate}
            i18n={i18n}
            changeLanguage={changeLanguage}
          />
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
