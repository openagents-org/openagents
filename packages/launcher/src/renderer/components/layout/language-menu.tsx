import React from "react"
import { Languages } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { Button } from "@renderer/components/ui/button"
import { SUPPORTED_LANGUAGES, changeLanguage, type LanguageCode } from "@renderer/i18n"
import { HeaderTooltip } from "./header-tooltip"

/**
 * The header's quick language switch, beside the theme's. The same setting as
 * Settings → Language, which also shows the regional formats. Kept in reach
 * because it is what someone looks for first when the app opens in a language
 * they do not read — and the last place they can find is a settings page in it.
 */
export function LanguageMenu(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const current = (i18n.resolvedLanguage ?? i18n.language) as LanguageCode
  const name = SUPPORTED_LANGUAGES.find((l) => l.value === current)?.label ?? current
  const label = `${t("settings.sections.language")}: ${name}`

  return (
    <DropdownMenu>
      <HeaderTooltip label={label}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label} data-testid="language-menu">
            <Languages className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </HeaderTooltip>
      <DropdownMenuContent align="end" side="bottom" className="w-40">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(v) => void changeLanguage(v as LanguageCode)}
          className="flex flex-col gap-0.5"
        >
          {/* Each language in its own name, so it can be found from any other. */}
          {SUPPORTED_LANGUAGES.map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value} className="text-xs">
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
