import React from "react"
import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { Switch } from "@renderer/components/ui/switch"
import {
  ACCENT_COLORS,
  UI_SCALES,
  useAppearanceStore,
  type AccentColor,
  type UiScale,
} from "@renderer/store/appearance"
import { getSkin } from "../../../../shared/skins"
import { cn } from "@renderer/lib/utils"
import { SettingsCard, Row } from "../components/settings-card"
import { SkinPicker } from "../components/skin-picker"
import { ThemePicker } from "../components/theme-picker"

/**
 * Every preset's colour is published as `--accent-<name>` on the root and
 * re-declared for dark mode, so a swatch can paint itself with the exact
 * value that clicking it applies — including the dark variant — even though
 * only one preset is live at a time. Reading them here is what keeps the dot
 * and the applied accent from drifting apart.
 */
const swatchFill = (color: AccentColor): string => `hsl(var(--accent-${color}))`

const SCALE_SAMPLE: Record<UiScale, string> = {
  sm: "text-2xs",
  md: "text-xs",
  lg: "text-sm",
}

export function AppearanceSection(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    accent,
    scale,
    animations,
    highContrast,
    skin,
    setAccent,
    setScale,
    setAnimations,
    setHighContrast,
  } = useAppearanceStore(
    useShallow((s) => ({
      accent: s.accent,
      scale: s.scale,
      animations: s.animations,
      highContrast: s.highContrast,
      skin: s.skin,
      setAccent: s.setAccent,
      setScale: s.setScale,
      setAnimations: s.setAnimations,
      setHighContrast: s.setHighContrast,
    })),
  )

  // A skin may pin the accent to its own colour, leaving the swatches below
  // nothing to change. Disabled rather than hidden: a row that vanishes reads
  // as a bug, one that greys out reads as a consequence — and the description
  // names the skin that caused it, so it stays true whichever one is on.
  const accentLocked = getSkin(skin).lockedAccent !== null
  const skinName = t(`settings.appearance.skins.${skin}.name`, {
    defaultValue: skin,
  })

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
          stacked
          label={t("settings.appearance.skin")}
          desc={t("settings.appearance.skinDesc")}
        >
          <SkinPicker />
        </Row>

        <Row
          label={t("settings.appearance.accent")}
          desc={
            accentLocked
              ? t("settings.appearance.accentLocked", { skin: skinName })
              : t("settings.appearance.accentDesc")
          }
        >
          <div
            className={cn(
              "flex flex-wrap gap-2",
              accentLocked && "pointer-events-none opacity-40",
            )}
          >
            {ACCENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                disabled={accentLocked}
                aria-label={t(`settings.appearance.accents.${color}`)}
                title={t(`settings.appearance.accents.${color}`)}
                onClick={() => setAccent(color)}
                style={{ backgroundColor: swatchFill(color) }}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-white transition-transform hover:scale-110",
                  accent === color &&
                    "ring-2 ring-foreground/40 ring-offset-2 ring-offset-card",
                )}
              >
                {accent === color && <Check className="size-3.5" />}
              </button>
            ))}
          </div>
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
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-muted-foreground hover:border-muted-foreground/40",
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
