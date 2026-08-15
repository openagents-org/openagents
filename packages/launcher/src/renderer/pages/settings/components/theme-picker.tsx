import React from "react"
import { useTranslation } from "react-i18next"
import { useShallow } from "zustand/react/shallow"
import { CircleCheck } from "lucide-react"

import { useThemeStore, type ThemeMode } from "@renderer/store/theme"
import { cn } from "@renderer/lib/utils"
import { ThemePreview } from "./theme-preview"

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"]

/** The three theme tiles: a miniature of the app in each mode. */
export function ThemePicker(): React.JSX.Element {
  const { t } = useTranslation()
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )

  return (
    <div className="grid grid-cols-3 gap-3">
      {THEME_MODES.map((m) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "relative flex flex-col gap-2 rounded-lg border p-2 text-center transition-colors",
              active
                ? "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-muted-foreground/40",
            )}
          >
            {active && (
              <CircleCheck className="absolute top-3 right-3 size-4 fill-primary text-primary-foreground" />
            )}

            <ThemePreview mode={m} />

            <span
              className={cn(
                "text-2xs",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {t(`settings.appearance.modes.${m}`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
