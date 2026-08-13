import React from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Eraser,
  FolderOpen,
  Palette,
  RotateCcw,
} from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { SettingsCard, Row } from "../components/settings-card"
import type { SettingsPaths } from "../use-settings-state"

interface Props {
  paths: SettingsPaths
  exportSettings: () => void | Promise<void>
  importSettings: () => void | Promise<void>
  openReset: () => void
  clearingCache: boolean
  clearCache: () => void | Promise<void>
  openLocalReset: () => void
}

/** Order of the storage-location rows; labels come from `settings.data.*`. */
const PATH_KEYS = [
  "openagentsHome",
  "userData",
  "logs",
  "cache",
  "downloads",
  "portableNode",
] as const

export function DataSection({
  paths,
  exportSettings,
  importSettings,
  openReset,
  clearingCache,
  clearCache,
  openLocalReset,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <SettingsCard title={t("settings.data.locationsGroup")}>
        {PATH_KEYS.map((key) => (
          <Row
            key={key}
            label={t(`settings.data.${key}`)}
            desc={
              <span className="font-mono break-all">
                {paths[key] || t("common.loading")}
              </span>
            }
          >
            <Button
              size="sm"
              variant="outline"
              disabled={!paths[key]}
              onClick={() => paths[key] && void window.api.showPath(paths[key]!)}
            >
              <FolderOpen />
              {t("common.reveal")}
            </Button>
          </Row>
        ))}
      </SettingsCard>

      <SettingsCard
        title={t("settings.data.backupGroup")}
        desc={t("settings.data.backupGroupDesc")}
      >
        <Row
          label={t("settings.data.exportSettings")}
          desc={t("settings.data.exportSettingsDesc")}
        >
          <Button size="sm" variant="outline" onClick={() => void exportSettings()}>
            <ArrowDownToLine />
            {t("common.export")}
          </Button>
        </Row>
        <Row
          label={t("settings.data.importSettings")}
          desc={t("settings.data.importSettingsDesc")}
        >
          <Button size="sm" variant="outline" onClick={() => void importSettings()}>
            <ArrowUpFromLine />
            {t("common.import")}
          </Button>
        </Row>
      </SettingsCard>

      {/* The launcher's own state, as opposed to the settings file above.
          Nothing here reaches the agents, the daemon or the workspace — it is
          the app's cache and the window's own appearance, both of which used to
          have no control at all and survived even a reinstall. */}
      <SettingsCard
        title={t("settings.data.localGroup")}
        desc={t("settings.data.localGroupDesc")}
      >
        <Row
          label={t("settings.data.clearCache")}
          desc={t("settings.data.clearCacheDesc")}
        >
          {/* Clearing and resetting are destructive entry points, so they take
              the destructive style like every other one in the app — the
              neutral outline made them read as ordinary settings controls. */}
          <Button
            size="sm"
            variant="destructive-ghost"
            disabled={clearingCache}
            onClick={() => void clearCache()}
          >
            {clearingCache ? <Spinner /> : <Eraser />}
            {t("common.clear")}
          </Button>
        </Row>
        <Row
          label={t("settings.data.resetLocal")}
          desc={t("settings.data.resetLocalDesc")}
        >
          <Button size="sm" variant="destructive-ghost" onClick={openLocalReset}>
            <Palette />
            {t("common.reset")}
          </Button>
        </Row>
      </SettingsCard>

      <SettingsCard title={t("settings.data.dangerGroup")}>
        <Row
          label={
            <span className="text-destructive">
              {t("settings.data.resetSettings")}
            </span>
          }
          desc={t("settings.data.resetSettingsDesc")}
        >
          {/* Entry point to a destructive action, not the confirmation — the
              dialog behind it carries the solid `destructive`. The card title
              and the red label already mark the danger; a frame on top of them
              made this the one odd button in the family. */}
          <Button size="sm" variant="destructive-ghost" onClick={openReset}>
            <RotateCcw />
            {t("common.reset")}
          </Button>
        </Row>
      </SettingsCard>
    </>
  )
}
