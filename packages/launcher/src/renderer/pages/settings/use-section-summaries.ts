import { useTranslation } from "react-i18next"
import { useShallow } from "zustand/react/shallow"

import { DEFAULT_SKIN, getSkin } from "../../../shared/skins"
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@renderer/i18n"
import { STARTUP_PAGES, STARTUP_PAGE_LAST } from "@renderer/hooks/useStartupPage"
import { useAppearanceStore } from "@renderer/store/appearance"
import { useNotificationsStore } from "@renderer/store/notifications"
import { useThemeStore } from "@renderer/store/theme"
import type { RuntimeInfo } from "@renderer/types"

import type { SectionId } from "./section-config"
import type { SettingsPaths, SettingsValues } from "./use-settings-state"

interface Input {
  values: SettingsValues
  paths: SettingsPaths
  runtimeInfo: RuntimeInfo | null
  launcherVersion: string
  agentCount: number
}

/** Summary lines read as one sentence made of facts; empty facts drop out. */
function join(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" · ")
}

const hour = (h: number): string => `${String(h).padStart(2, "0")}:00`

/**
 * The one line under each module on the settings overview. It shows what that
 * module is currently set to — the point of the grid is to answer "is this
 * already how I want it?" without opening anything.
 */
export function useSectionSummaries({
  values,
  paths,
  runtimeInfo,
  launcherVersion,
  agentCount,
}: Input): Record<SectionId, string> {
  const { t, i18n } = useTranslation()
  const mode = useThemeStore((s) => s.mode)
  const { accent, scale, skin } = useAppearanceStore(
    useShallow((s) => ({ accent: s.accent, scale: s.scale, skin: s.skin })),
  )
  const prefs = useNotificationsStore((s) => s.prefs)

  const loading = t("common.loading")

  const language = (i18n.resolvedLanguage ?? i18n.language) as LanguageCode
  const languageLabel =
    SUPPORTED_LANGUAGES.find((l) => l.value === language)?.label ?? language

  const startupPage = STARTUP_PAGES.includes(
    values.startupPage as (typeof STARTUP_PAGES)[number],
  )
    ? t(`nav.items.${values.startupPage}.label`)
    : t("settings.general.startupPageLast")

  const proxied = !!(values.httpProxy || values.httpsProxy)

  const skinLocksAccent = getSkin(skin).lockedAccent !== null

  return {
    general: join(
      t("settings.summary.startupPage", { page: startupPage }),
      values.minimizeToTray
        ? t("settings.summary.trayOn")
        : t("settings.summary.trayOff"),
    ),
    appearance: join(
      t(`settings.appearance.modes.${mode}`),
      // The skin is named only when it is not the default — "Default · Violet"
      // spends a slot on a non-fact. The accent is dropped in the other
      // direction: a skin that pins its own colour makes the stored preset
      // something the user cannot see anywhere in the app.
      skinLocksAccent
        ? t(`settings.appearance.skins.${skin}.name`, { defaultValue: skin })
        : join(
            skin !== DEFAULT_SKIN &&
              t(`settings.appearance.skins.${skin}.name`, {
                defaultValue: skin,
              }),
            t("settings.summary.accent", {
              color: t(`settings.appearance.accents.${accent}`),
            }),
          ),
      t("settings.summary.scale", {
        size: t(`settings.appearance.scales.${scale}`),
      }),
    ),
    language: join(
      languageLabel,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    agents: join(
      t("settings.summary.agentsConfigured", { count: agentCount }),
      values.agentAutoStart
        ? t("settings.summary.autoStartOn")
        : t("settings.summary.autoStartOff"),
    ),
    notifications: !prefs
      ? loading
      : join(
          prefs.enabled
            ? t("settings.summary.notificationsOn")
            : t("settings.summary.notificationsOff"),
          prefs.quietHours
            ? t("settings.summary.quietHours", {
                start: hour(prefs.quietHours[0]),
                end: hour(prefs.quietHours[1]),
              })
            : t("settings.summary.quietHoursOff"),
        ),
    network: join(
      t(
        values.downloadRegion === "cn"
          ? "settings.network.regionCn"
          : values.downloadRegion === "global"
            ? "settings.network.regionGlobal"
            : "settings.network.regionAuto",
      ),
      values.workspaceEndpoint
        ? t("settings.summary.workspaceCustom")
        : t("settings.summary.workspaceHosted"),
      proxied && t("settings.summary.proxyOn"),
    ),
    data: paths.openagentsHome || loading,
    updates: join(
      launcherVersion,
      values.autoUpdate
        ? t("settings.summary.autoUpdateOn")
        : t("settings.summary.autoUpdateOff"),
    ),
    runtime: runtimeInfo?.nodeVersion
      ? join(
          `Node.js ${runtimeInfo.nodeVersion}`,
          runtimeInfo.coreVersion &&
            t("settings.summary.core", { version: runtimeInfo.coreVersion }),
        )
      : loading,
    about: join(t("settings.about.productName"), launcherVersion),
  }
}
