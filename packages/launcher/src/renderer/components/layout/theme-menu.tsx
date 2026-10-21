import React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { Button } from "@renderer/components/ui/button"
import { useThemeStore, type ThemeMode } from "@renderer/store/theme"

const THEME_MODES = [
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
  { id: "system", icon: Monitor },
] as const

/**
 * The top bar's quick theme switch. Everything else about appearance — skin,
 * accent, scale — lives in Settings → Appearance.
 */
export function ThemeMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const { mode, resolved, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, resolved: s.resolved, setMode: s.setMode })),
  )
  // The icon shows what is on screen; the menu says which setting produced it.
  const Icon = resolved === "dark" ? Moon : Sun
  const label = `${t("nav.themeToggle")}: ${t(`settings.appearance.modes.${mode}`)}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label} data-testid="theme-menu">
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as ThemeMode)}
          className="flex flex-col gap-0.5"
        >
          {THEME_MODES.map(({ id, icon: ModeIcon }) => (
            <DropdownMenuRadioItem key={id} value={id} className="text-xs">
              <ModeIcon className="size-3.5" />
              {t(`settings.appearance.modes.${id}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
