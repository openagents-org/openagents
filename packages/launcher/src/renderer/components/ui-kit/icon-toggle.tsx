import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@renderer/lib/utils"

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
 * is a tooltip away.
 *
 * It exists because the same control had grown three different looks across
 * the app (bordered + secondary fill, borderless, bordered + brand tint). The
 * brand tint is the one kept: it matches how selection reads everywhere else,
 * and a solid fill is too heavy for a control this small.
 */
export function IconToggle<T extends string>({
  value,
  options,
  onChange,
  className,
}: IconToggleProps<T>): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-md border p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex size-6 items-center justify-center rounded-sm border-0 bg-transparent transition-colors",
              "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <option.icon />
          </button>
        )
      })}
    </div>
  )
}
