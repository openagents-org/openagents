import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { Switch } from "@renderer/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import {
  STARTUP_PAGES,
  STARTUP_PAGE_LAST,
} from "@renderer/hooks/useStartupPage"
import { SettingsCard, Row } from "../components/settings-card"
import type { SettingsValues, Update } from "../use-settings-state"

interface Props {
  values: SettingsValues
  update: Update
}

export function GeneralSection({ values, update }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [restartOpen, setRestartOpen] = useState(false)

  return (
    <>
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

        {/* Sits with the startup switches because that is when it applies: the
            flag is read once, as Chromium boots. */}
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

      <Card className="mb-4 flex-row items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold">
            {t("settings.general.restartGroup")}
          </h3>
          <p className="mt-0.5 mb-0 text-2xs text-muted-foreground">
            {t("settings.general.restartGroupDesc")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRestartOpen(true)}>
          {t("settings.general.restartNow")}
        </Button>
      </Card>

      {/* A restart stops every running agent on the way out, so it asks first —
          they only come back on their own if auto-start is on. */}
      <ConfirmDialog
        open={restartOpen}
        title={t("settings.general.restartDialog.title")}
        description={t("settings.general.restartDialog.description")}
        confirmLabel={t("settings.general.restartDialog.confirm")}
        destructive={false}
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => {
          setRestartOpen(false)
          void window.api.relaunchApp()
        }}
      />
    </>
  )
}
