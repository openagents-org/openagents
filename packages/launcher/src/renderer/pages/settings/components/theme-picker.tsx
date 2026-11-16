import React from "react"
import { useTranslation } from "react-i18next"
import { useShallow } from "zustand/react/shallow"

import { useThemeStore, type ThemeMode } from "@renderer/store/theme"
import { Field, FieldLabel, FieldTitle } from "@renderer/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@renderer/components/ui/radio-group"
import { ThemePreview } from "./theme-preview"

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"]

/** The three theme tiles: a miniature of the app in each mode. */
export function ThemePicker(): React.JSX.Element {
  const { t } = useTranslation()
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )

  return (
    // shadcn's choice cards: each tile is a FieldLabel around the Field, so
    // the whole tile picks the radio inside it.
    <RadioGroup
      value={mode}
      onValueChange={(v) => setMode(v as ThemeMode)}
      className="grid grid-cols-3 gap-3"
      aria-label={t("settings.appearance.theme")}
    >
      {THEME_MODES.map((m) => (
        <FieldLabel key={m} htmlFor={`theme-mode-${m}`}>
          <Field>
            <ThemePreview mode={m} />
            <div className="flex items-center gap-2">
              <RadioGroupItem value={m} id={`theme-mode-${m}`} />
              <FieldTitle>{t(`settings.appearance.modes.${m}`)}</FieldTitle>
            </div>
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}
