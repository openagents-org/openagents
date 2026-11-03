import React from "react"
import { useTranslation } from "react-i18next"
import { useShallow } from "zustand/react/shallow"

import { Switch } from "@renderer/components/ui/switch"
import {
  UI_SCALES,
  useAppearanceStore,
  type UiScale,
} from "@renderer/store/appearance"
import { cn } from "@renderer/lib/utils"
import { SettingsCard, Row } from "../components/settings-card"
import { ThemePicker } from "../components/theme-picker"

const SCALE_SAMPLE: Record<UiScale, string> = {
  sm: "text-2xs",
  md: "text-xs",
  lg: "text-sm",
}

export function AppearanceSection(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    scale,
    animations,
    highContrast,
    setScale,
    setAnimations,
    setHighContrast,
  } = useAppearanceStore(
    useShallow((s) => ({
      scale: s.scale,
      animations: s.animations,
      highContrast: s.highContrast,
      setScale: s.setScale,
      setAnimations: s.setAnimations,
      setHighContrast: s.setHighContrast,
    })),
  )

  return (
    <>
      <SettingsCard title={t("settings.appearance.themeGroup")}>
        <Row
          stacked
          label={t("settings.appearance.theme")}
          desc={t("settings.appearance.themeDesc")}
        >
          <ThemePicker />
        </Row>

        <Row
          label={t("settings.appearance.scale")}
          desc={t("settings.appearance.scaleDesc")}
        >
          <div className="flex gap-1.5">
            {UI_SCALES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScale(s)}
                className={cn(
                  "rounded-md border px-3 py-1.5 transition-colors",
                  SCALE_SAMPLE[s],
                  scale === s
                    ? "border-primary bg-accent font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {t(`settings.appearance.scales.${s}`)}
              </button>
            ))}
          </div>
        </Row>
      </SettingsCard>

      {/* Both switches are pure CSS, applied through data attributes on <html>
          (see the appearance blocks in globals.css), so they take effect the
          moment they are flipped and survive a restart via localStorage. */}
      <SettingsCard title={t("settings.appearance.behaviorGroup")}>
        <Row
          label={t("settings.appearance.animations")}
          desc={t("settings.appearance.animationsDesc")}
        >
          <Switch checked={animations} onCheckedChange={setAnimations} />
        </Row>

        <Row
          label={t("settings.appearance.highContrast")}
          desc={t("settings.appearance.highContrastDesc")}
        >
          <Switch checked={highContrast} onCheckedChange={setHighContrast} />
        </Row>
      </SettingsCard>
    </>
  )
}
