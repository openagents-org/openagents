import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@renderer/components/ui/badge"
import { Switch } from "@renderer/components/ui/switch"
import {
  SectionHeading,
  SettingsCard,
  Row,
  InfoRow,
} from "../components/settings-card"
import { LauncherUpdate } from "../components/launcher-update"
import type { SettingsValues, Update } from "../use-settings-state"
import type { UpdaterState } from "@renderer/types"

interface Props {
  values: SettingsValues
  update: Update
  launcherVersion: string
  updater: UpdaterState | null
  checkUpdate: () => void | Promise<void>
  downloadUpdate: () => void | Promise<void>
  installUpdate: () => void | Promise<void>
}

export function UpdatesSection({
  values,
  update,
  launcherVersion,
  updater,
  checkUpdate,
  downloadUpdate,
  installUpdate,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <SectionHeading
        title={t("settings.pages.updates.title")}
        desc={t("settings.pages.updates.desc")}
      />

      <LauncherUpdate
        state={updater}
        currentVersion={launcherVersion}
        onCheck={checkUpdate}
        onDownload={downloadUpdate}
        onInstall={installUpdate}
      />

      <SettingsCard title={t("settings.updates.settingsGroup")}>
        <Row
          label={t("settings.updates.autoUpdate")}
          desc={t("settings.updates.autoUpdateDesc")}
        >
          <Switch
            checked={values.autoUpdate}
            onCheckedChange={(v) => update("autoUpdate", v)}
          />
        </Row>
      </SettingsCard>

      <SettingsCard title={t("settings.updates.versionGroup")}>
        <InfoRow
          label={t("settings.updates.installedVersion")}
          value={launcherVersion}
          mono
        />
        <InfoRow
          label={t("settings.updates.latestVersion")}
          value={
            updater?.latestVersion
              ? `v${updater.latestVersion}`
              : t("settings.runtime.unableToCheck")
          }
          mono
        />
        <InfoRow
          label={t("settings.updates.channel")}
          trailing={<Badge variant="muted">{t("settings.updates.channelStable")}</Badge>}
        />
      </SettingsCard>
    </>
  )
}
