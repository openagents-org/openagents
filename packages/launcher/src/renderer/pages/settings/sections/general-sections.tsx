import React from "react"
import { useTranslation } from "react-i18next"

import { Separator } from "@renderer/components/ui/separator"
import { Switch } from "@renderer/components/ui/switch"
import { SettingsCard, Row } from "../components/settings-card"
import { cn } from "@renderer/lib/utils"
import type { SectionId } from "../section-config"
import type { SettingsValues } from "../use-settings-state"

type Update = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) => void
import type { ThemeMode } from "@renderer/store/theme"

interface Props {
  section: SectionId
  values: SettingsValues
  update: Update
  themeMode: ThemeMode
  setThemeMode: (m: ThemeMode) => void
}

export function GeneralSections({
  section,
  values,
  update,
  themeMode,
  setThemeMode,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
          {section === "general" && (
            <SettingsCard title={t("settings.general.title")}>
              <Row
                label={t("settings.general.startOnBoot")}
                desc={t("settings.general.startOnBootDesc")}
              >
                <Switch
                  checked={values.startOnBoot}
                  onCheckedChange={(v) => {
                    update("startOnBoot", v)
                  }}
                />
              </Row>
              <Separator />
              <Row
                label={t("settings.general.minimizeToTray")}
                desc={t("settings.general.minimizeToTrayDesc")}
              >
                <Switch
                  checked={values.minimizeToTray}
                  onCheckedChange={(v) => {
                    update("minimizeToTray", v)
                  }}
                />
              </Row>
              <Separator />
              <Row
                label={t("settings.general.gpuAcceleration")}
                desc={t("settings.general.gpuAccelerationDesc")}
              >
                <Switch
                  checked={values.gpuAcceleration}
                  onCheckedChange={(v) => {
                    update("gpuAcceleration", v)
                  }}
                />
              </Row>
            </SettingsCard>
          )}

          {section === "appearance" && (
            <SettingsCard title={t("settings.appearance.title")}>
              <Row label={t("settings.appearance.theme")} desc={t("settings.appearance.themeDesc")}>
                <div className="flex gap-1.5">
                  {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setThemeMode(m)}
                      className={cn(
                        "px-3 py-1.5 rounded-sm text-xs border cursor-pointer",
                        themeMode === m
                          ? "border-(--accent) bg-(--accent-bg) text-(--accent) font-semibold"
                          : "border-(--border) bg-(--bg-card) text-(--text-secondary) hover:border-(--border-hover)",
                      )}
                    >
                      {t(`settings.appearance.modes.${m}`)}
                    </button>
                  ))}
                </div>
              </Row>
            </SettingsCard>
          )}

    </>
  )
}
