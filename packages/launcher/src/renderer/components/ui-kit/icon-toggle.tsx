import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@renderer/components/ui/toggle-group"

export interface IconToggleOption<T extends string> {
  value: T
  icon: LucideIcon
  /** Names the option for the tooltip and for screen readers. */
  label: string
}

export interface IconToggleProps<T extends string> {
  value: T
  options: Array<IconToggleOption<T>>
  onChange: (value: T) => void
  className?: string
}

/**
 * Segmented icon switch — grid/list, row density, and anything else that picks
 * one of a few views. Icon only: these sit in crowded toolbars, and the label
 * is a tooltip away. A connected, single-choice outline ToggleGroup.
 */
export function IconToggle<T extends string>({
  value,
  options,
  onChange,
  className,
}: IconToggleProps<T>): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      // Radix reports "" when the pressed item is clicked again; a view
      // switch always has one view showing, so that click changes nothing.
      onValueChange={(v) => v && onChange(v as T)}
      className={className}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          title={option.label}
        >
          <option.icon />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
