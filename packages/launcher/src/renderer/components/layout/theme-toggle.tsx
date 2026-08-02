import React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/shadcn/button"
import { useThemeStore, type ThemeMode } from "@renderer/store/theme"

/** Cycles light → dark → system, showing the mode currently in effect. */
const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  light: "dark",
  dark: "system",
  system: "light",
}

const MODE_ICON = { light: Sun, dark: Moon, system: Monitor } as const

export function ThemeToggle(): React.JSX.Element {
  const { t } = useTranslation()
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )
  const next = NEXT_MODE[mode]
  const Icon = MODE_ICON[mode]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setMode(next)}
      title={t("nav.themeTooltip", {
        mode: t(`settings.appearance.modes.${mode}`),
        next: t(`settings.appearance.modes.${next}`),
      })}
      aria-label={t("nav.themeToggle")}
      className="size-7 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Icon className="size-3.5" />
    </Button>
  )
}
