import React from "react"

import { Badge } from "@renderer/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@renderer/components/ui/toggle-group"

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
  /** Match the height of the controls beside it. */
  size?: "sm" | "default"
  /** `underline`: tabs beside a section title, the current one underlined. */
  variant?: "chips" | "underline"
  className?: string
}

/**
 * The list-filter control every page shares.
 *
 * Always on screen rather than in a dropdown: the buckets are few and
 * switching between them is the most frequent thing done on these pages. The
 * count rides on the option because the filter and the number of rows it would
 * leave are the same fact.
 *
 * `underline` is shadcn's line Tabs with the count as a Badge (dashboard-01);
 * `chips` is a single-choice outline ToggleGroup.
 */
export function FilterChips<T extends string>({
  value,
  options,
  onChange,
  size = "default",
  variant = "chips",
  className,
}: FilterChipsProps<T>): React.JSX.Element {
  if (variant === "underline") {
    return (
      <Tabs value={value} onValueChange={(v) => onChange(v as T)} className={className}>
        <TabsList variant="line">
          {options.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
              {option.count !== undefined && (
                <Badge variant="secondary" className="tabular-nums">
                  {option.count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    )
  }
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size={size === "sm" ? "sm" : "default"}
      value={value}
      // Radix reports "" when the pressed item is clicked again; a filter
      // always has one bucket chosen, so that click changes nothing.
      onValueChange={(v) => v && onChange(v as T)}
      className={className}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
          {option.count !== undefined && (
            <span className="text-muted-foreground tabular-nums">{option.count}</span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
