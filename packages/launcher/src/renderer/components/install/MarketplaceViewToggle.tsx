import React from "react"
import { LayoutGrid, List } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../ui/button"
import { ButtonGroup } from "../ui/button-group"
import type { MarketplaceView } from "../../hooks/useMarketplacePrefs"

interface MarketplaceViewToggleProps {
  value: MarketplaceView
  onChange: (next: MarketplaceView) => void
}

const OPTIONS = [
  { key: "grid", icon: LayoutGrid, labelKey: "install.viewToggle.grid" },
  { key: "list", icon: List, labelKey: "install.viewToggle.list" },
] as const

/** Grid / list toggle. Preference is persisted via useMarketplacePrefs. */
export function MarketplaceViewToggle({
  value,
  onChange,
}: MarketplaceViewToggleProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ButtonGroup>
      {OPTIONS.map((opt) => {
        const label = t(opt.labelKey)
        return (
          <Button
            key={opt.key}
            size="sm"
            variant={value === opt.key ? "default" : "outline"}
            onClick={() => onChange(opt.key)}
            title={t("install.viewToggle.viewLabel", { label })}
            aria-pressed={value === opt.key}
            className="text-2xs"
          >
            <opt.icon />
            {label}
          </Button>
        )
      })}
    </ButtonGroup>
  )
}
