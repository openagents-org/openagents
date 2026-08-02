import React from "react"
import { useTranslation } from "react-i18next"

import { Separator } from "@renderer/components/ui/separator"
import { Switch } from "@renderer/components/ui/switch"
import { SettingsCard, Row } from "../components/settings-card"
import { cn } from "@renderer/lib/utils"
import type { SectionId } from "../section-config"
import type { SettingsValues } from "../use-settings-state"

type Update = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) => void
import { Button } from "@renderer/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { LauncherUpdate } from "../components/launcher-update"
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@renderer/i18n"
import type { SettingsPaths } from "../use-settings-state"
import type { UpdaterState } from "@renderer/types"

interface Props {
  section: SectionId
  values: SettingsValues
  update: Update
  paths: SettingsPaths
  runtimeRows: Array<{ label: string; value: string; color?: string }>
  launcherVersion: string
  updater: UpdaterState | null
  checkUpdate: () => void | Promise<void>
  downloadUpdate: () => void | Promise<void>
  installUpdate: () => void | Promise<void>
  i18n: { resolvedLanguage?: string; language: string }
  changeLanguage: (code: LanguageCode) => unknown
}

export function SystemSections({
  section,
  values,
  update,
  paths,
  runtimeRows,
  launcherVersion,
  updater,
  checkUpdate,
  downloadUpdate,
  installUpdate,
  i18n,
  changeLanguage,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
          {section === "data" && (
            <SettingsCard title={t("settings.data.title")}>
              {paths ? (
                <ul className="m-0 p-0 list-none">
                  {[
                    [t("settings.data.userData"), paths.userData],
                    [t("settings.data.openagentsHome"), paths.openagentsHome],
                    [t("settings.data.logs"), paths.logs],
                    [t("settings.data.downloads"), paths.downloads],
                    [t("settings.data.cache"), paths.cache],
                    [t("settings.data.portableNode"), paths.portableNode],
                  ].map(([label, p]) => (
                    <li
                      key={label}
                      className="flex items-center justify-between gap-3 py-2.5 border-b border-(--border) last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-(--text-primary)">
                          {label}
                        </div>
                        <div className="text-2xs text-(--text-tertiary) truncate font-mono">
                          {p}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => p && void window.api.showPath(p)}>
                        {t("common.reveal")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-(--text-tertiary)">{t("common.loading")}</p>
              )}
            </SettingsCard>
          )}

          {section === "language" && (
            <SettingsCard title={t("settings.language.title")}>
              <Row
                label={t("settings.language.displayLanguage")}
                desc={t("settings.language.displayLanguageDesc")}
              >
                <Select
                  value={(i18n.resolvedLanguage ?? i18n.language) as LanguageCode}
                  onValueChange={(v) => void changeLanguage(v as LanguageCode)}
                >
                  <SelectTrigger size="sm" className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </SettingsCard>
          )}

          {section === "updates" && (
            <SettingsCard title={t("settings.updates.title")}>
              <Row
                label={t("settings.updates.autoUpdate")}
                desc={t("settings.updates.autoUpdateDesc")}
              >
                <Switch
                  checked={values.autoUpdate}
                  onCheckedChange={(v) => {
                    update("autoUpdate", v)
                  }}
                />
              </Row>
              <Separator />
              <LauncherUpdate
                state={updater}
                currentVersion={launcherVersion}
                onCheck={checkUpdate}
                onDownload={downloadUpdate}
                onInstall={installUpdate}
              />
            </SettingsCard>
          )}

          {section === "runtime" && (
            <SettingsCard title={t("settings.runtime.title")}>
              {runtimeRows.map((row, idx) => (
                <div
                  key={row.label}
                  className={cn(
                    "flex justify-between items-center py-2.5 text-sm border-b border-(--border)",
                    idx === runtimeRows.length - 1 && "border-b-0",
                  )}
                >
                  <span className="text-(--text-secondary)">{row.label}</span>
                  <span style={{ color: row.color }}>{row.value}</span>
                </div>
              ))}
            </SettingsCard>
          )}

          {section === "about" && (
            <SettingsCard title={t("settings.about.title")}>
              <p className="text-sm m-0 mb-2 flex items-center gap-1.5">
                {t("settings.about.appLine", { version: launcherVersion })}
              </p>
              <p className="text-sm m-0">
                <button
                  type="button"
                  className="bg-transparent border-0 p-0 text-(--accent) underline cursor-pointer"
                  onClick={() => {
                    window.api.openExternal("https://openagents.org/docs")
                  }}
                >
                  {t("common.documentation")}
                </button>
              </p>
            </SettingsCard>
          )}
    </>
  )
}
