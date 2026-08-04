import React from "react"

import { cn } from "@renderer/lib/utils"

export interface FilterChipOption<T extends string = string> {
  value: T
  label: string
  /** Left off when a bucket has no meaningful number behind it. */
  count?: number
}

export interface FilterChipsProps<T extends string> {
  value: T
  options: FilterChipOption<T>[]
  onChange: (value: T) => void
  /** Match the height of the controls beside it: `sm` is 32px, default 36px. */
  size?: "sm" | "default"
  className?: string
}

/**
 * The list-filter control every page shares.
 *
 * Chips rather than a dropdown: the buckets are few and switching between them
 * is the most frequent thing done on these pages, so they stay on screen and
 * one click apart. The count rides on the chip because the filter and the
 * number of rows it would leave are the same fact — split across a filter row
 * and a stats row, the page repeats itself.
 */
export function FilterChips<T extends string>({
  value,
  options,
  onChange,
  size = "default",
  className,
}: FilterChipsProps<T>): React.JSX.Element {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 text-xs transition-colors",
              size === "sm" ? "h-8" : "h-9",
              active
                ? "border-primary bg-primary font-medium text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn("tabular-nums", active ? "opacity-80" : "opacity-70")}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
