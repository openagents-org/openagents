import React from "react"
import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import {
  ACCENT_COLORS,
  UI_SCALES,
  useAppearanceStore,
  type AccentColor,
  type UiScale,
} from "@renderer/store/appearance"
import { useThemeStore, type ThemeMode } from "@renderer/store/theme"
import { cn } from "@renderer/lib/utils"
import { SectionHeading, SettingsCard, Row } from "../components/settings-card"
import { ThemePreview } from "../components/theme-preview"

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"]

/**
 * Swatch fills. Hard-coded rather than read from the CSS presets because a
 * swatch has to show what a colour *would* look like, not what the currently
 * applied accent looks like — only one of them is live at a time.
 */
const SWATCH: Record<AccentColor, string> = {
  indigo: "bg-indigo-500",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
  slate: "bg-slate-500",
}

const SCALE_SAMPLE: Record<UiScale, string> = {
  sm: "text-2xs",
  md: "text-xs",
  lg: "text-sm",
}

export function AppearanceSection(): React.JSX.Element {
  const { t } = useTranslation()
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )
  const { accent, scale, setAccent, setScale } = useAppearanceStore(
    useShallow((s) => ({
      accent: s.accent,
      scale: s.scale,
      setAccent: s.setAccent,
      setScale: s.setScale,
    })),
  )

  return (
    <>
      <SectionHeading
        title={t("settings.pages.appearance.title")}
        desc={t("settings.pages.appearance.desc")}
      />

      <SettingsCard
        title={t("settings.appearance.themeGroup")}
        desc={t("settings.appearance.themeDesc")}
      >
        <div className="grid grid-cols-3 gap-3 py-3">
          {THEME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-center transition-colors",
                mode === m
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border hover:border-muted-foreground/40",
              )}
            >
              <ThemePreview mode={m} />
              <span
                className={cn(
                  "text-2xs",
                  mode === m ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`settings.appearance.modes.${m}`)}
              </span>
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title={t("settings.appearance.accentGroup")}>
        <Row
          label={t("settings.appearance.accent")}
          desc={t("settings.appearance.accentDesc")}
        >
          <div className="flex flex-wrap gap-2">
            {ACCENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={t(`settings.appearance.accents.${color}`)}
                title={t(`settings.appearance.accents.${color}`)}
                onClick={() => setAccent(color)}
                className={cn(
                  "flex size-6 cursor-pointer items-center justify-center rounded-full text-white transition-transform hover:scale-110",
                  SWATCH[color],
                  accent === color && "ring-2 ring-foreground/40 ring-offset-2 ring-offset-card",
                )}
              >
                {accent === color && <Check className="size-3.5" />}
              </button>
            ))}
          </div>
        </Row>
      </SettingsCard>

      <SettingsCard title={t("settings.appearance.scaleGroup")}>
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
                  "cursor-pointer rounded-md border px-3 py-1.5 transition-colors",
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
    </>
  )
}
