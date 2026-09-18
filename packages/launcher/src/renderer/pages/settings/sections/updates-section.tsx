import React from "react"
import { useTranslation } from "react-i18next"
import { Sparkles } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Switch } from "@renderer/components/ui/switch"
import { WhatsNewDialog } from "@renderer/components/whats-new/whats-new-dialog"
import { RELEASES } from "@renderer/lib/changelog"
import { SettingsCard,
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
  const [notesOpen, setNotesOpen] = React.useState(false)

  return (
    <>
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
        {/* The same notes the app shows once after an update, kept reachable
            afterwards — the dialog is easy to dismiss before reading it. */}
        <Row
          label={t("whatsNew.settingsRow")}
          desc={t("whatsNew.settingsRowDesc")}
        >
          <Button
            size="sm"
            variant="outline"
            disabled={RELEASES.length === 0}
            onClick={() => setNotesOpen(true)}
          >
            <Sparkles />
            {t("whatsNew.settingsAction")}
          </Button>
        </Row>
      </SettingsCard>

      <WhatsNewDialog
        open={notesOpen}
        releases={RELEASES}
        onClose={() => setNotesOpen(false)}
      />
    </>
  )
}
