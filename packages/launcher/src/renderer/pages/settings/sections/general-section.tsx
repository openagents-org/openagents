import React from "react"
import { useTranslation } from "react-i18next"

import { Switch } from "@renderer/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import {
  STARTUP_PAGES,
  STARTUP_PAGE_LAST,
} from "@renderer/hooks/useStartupPage"
import { SectionHeading, SettingsCard, Row } from "../components/settings-card"
import type { SettingsValues, Update } from "../use-settings-state"

interface Props {
  values: SettingsValues
  update: Update
}

export function GeneralSection({ values, update }: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <SectionHeading
        title={t("settings.pages.general.title")}
        desc={t("settings.pages.general.desc")}
      />

      <SettingsCard title={t("settings.general.startupGroup")}>
        <Row
          label={t("settings.general.startOnBoot")}
          desc={t("settings.general.startOnBootDesc")}
        >
          <Switch
            checked={values.startOnBoot}
            onCheckedChange={(v) => update("startOnBoot", v)}
          />
        </Row>

        <Row
          label={t("settings.general.startupPage")}
          desc={t("settings.general.startupPageDesc")}
        >
          <Select
            value={values.startupPage}
            onValueChange={(v) => update("startupPage", v)}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STARTUP_PAGE_LAST}>
                {t("settings.general.startupPageLast")}
              </SelectItem>
              {STARTUP_PAGES.map((page) => (
                <SelectItem key={page} value={page}>
                  {t(`nav.items.${page}.label`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label={t("settings.general.minimizeToTray")}
          desc={t("settings.general.minimizeToTrayDesc")}
        >
          <Switch
            checked={values.minimizeToTray}
            onCheckedChange={(v) => update("minimizeToTray", v)}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("settings.general.performanceGroup")}
        desc={t("settings.general.performanceGroupDesc")}
      >
        <Row
          label={t("settings.general.gpuAcceleration")}
          desc={t("settings.general.gpuAccelerationDesc")}
        >
          <Switch
            checked={values.gpuAcceleration}
            onCheckedChange={(v) => update("gpuAcceleration", v)}
          />
        </Row>
      </SettingsCard>
    </>
  )
}
