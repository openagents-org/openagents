import React from "react"
import { SlidersHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Checkbox } from "@renderer/components/ui/checkbox"
import { Label } from "@renderer/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Separator } from "@renderer/components/ui/separator"
import { SearchInput } from "@renderer/components/ui-kit"
import { cn } from "@renderer/lib/utils"
import type { LogEventType, LogLevel } from "@renderer/services/logs/log-parser"
import type { Agent } from "@renderer/types"
import { LEVEL_ORDER } from "../use-log-view"

/** Sentinel for "no agent filter" — Radix Select forbids an empty item value. */
export const ALL_AGENTS = "__all__"

export const EVENT_TYPES: LogEventType[] = [
  "poll",
  "heartbeat",
  "message",
  "network",
  "lifecycle",
  "auth",
  "log",
]

/** Each level's dot, so the segment names its colour as well as its word. */
const LEVEL_DOT: Record<LogLevel, string> = {
  error: "bg-(--danger)",
  warn: "bg-(--warning)",
  info: "bg-(--info)",
  debug: "bg-muted-foreground",
  trace: "bg-muted-foreground",
  unknown: "bg-muted-foreground",
}

const SEGMENT = "flex h-9 items-center gap-1.5 px-3.5 text-sm whitespace-nowrap transition-colors"

interface Props {
  agents: Agent[]
  agentFilter: string
  onAgentFilterChange: (v: string) => void
  search: string
  onSearchChange: (v: string) => void
  levels: Set<LogLevel>
  onLevelsChange: (next: Set<LogLevel>) => void
  levelCounts: Record<LogLevel, number>
  eventTypes: Set<LogEventType>
  onEventTypesChange: (next: Set<LogEventType>) => void
  onlyWithStack: boolean
  onOnlyWithStackChange: (v: boolean) => void
  /** Rendered first in the row — the time range. */
  leading?: React.ReactNode
}

export function LogsFilterBar({
  agents,
  agentFilter,
  onAgentFilterChange,
  search,
  onSearchChange,
  levels,
  onLevelsChange,
  levelCounts,
  eventTypes,
  onEventTypesChange,
  onlyWithStack,
  onOnlyWithStackChange,
  leading,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const allLevels = LEVEL_ORDER.every((l) => levels.has(l))
  const extraCount = eventTypes.size + (onlyWithStack ? 1 : 0)

  // Level pills behave as a single choice: picking one narrows to it, picking
  // it again widens back to everything.
  const pickLevel = (level: LogLevel): void => {
    const isOnly = levels.size === 1 && levels.has(level)
    onLevelsChange(isOnly ? new Set(LEVEL_ORDER) : new Set([level]))
  }

  const toggleEventType = (type: LogEventType): void => {
    const next = new Set(eventTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onEventTypesChange(next)
  }

  return (
    // Two groups rather than one flat row, so a wrap lands BETWEEN them and
    // never mid-group: the level pills, the filter popover and the live switch
    // read as one cluster and would look unrelated once split across lines.
    // The query group takes the leftover width — it holds the only control that
    // gets more useful the wider it is — and drops to a full line of its own
    // once the two no longer fit, which is where the search field gets roomy.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <div className="flex min-w-80 flex-1 items-center gap-3">
        {leading}
        <Select
          value={agentFilter || ALL_AGENTS}
          onValueChange={(v) => onAgentFilterChange(v === ALL_AGENTS ? "" : v)}
        >
          <SelectTrigger className="w-36 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_AGENTS}>{t("logs.allAgents")}</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.name} value={a.name}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* `min-w-0` is what lets the field shrink past the input's intrinsic
            width instead of forcing the group wider than its share. */}
        <SearchInput
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onClear={() => onSearchChange("")}
          placeholder={t("logs.searchPlaceholder")}
          wrapperClassName="min-w-0 flex-1"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div role="radiogroup" className="flex overflow-hidden rounded-md border bg-card">
          <button
            type="button"
            role="radio"
            aria-checked={allLevels}
            onClick={() => onLevelsChange(new Set(LEVEL_ORDER))}
            className={cn(SEGMENT, allLevels ? "bg-(--accent-bg) font-medium text-primary" : "hover:bg-muted")}
          >
            {t("logs.levels.all")}
          </button>
          {LEVEL_ORDER.map((level) => {
            const active = levels.has(level) && !allLevels
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickLevel(level)}
                title={t("logs.levelCount", { count: levelCounts[level] })}
                className={cn(SEGMENT, "border-l", active ? "bg-(--accent-bg) font-medium text-primary" : "hover:bg-muted")}
              >
                <span className={cn("size-2 rounded-full", LEVEL_DOT[level])} />
                {/* Same keys the table badge and the timeline read, so the three
                    places a level is named can never drift apart. */}
                {t(`logs.levels.${level}`)}
              </button>
            )
          })}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <SlidersHorizontal />
              {t("logs.actions.moreFilters")}
              {extraCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-3xs text-primary-foreground">
                  {extraCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56">
            <p className="mb-2 text-2xs font-semibold text-muted-foreground">
              {t("logs.filters.eventType")}
            </p>
            <div className="flex flex-col gap-1.5">
              {EVENT_TYPES.map((type) => (
                <Label key={type} className="cursor-pointer text-xs font-normal">
                  <Checkbox
                    checked={eventTypes.has(type)}
                    onCheckedChange={() => toggleEventType(type)}
                  />
                  {t(`logs.eventType.${type}`)}
                </Label>
              ))}
            </div>
            <Separator className="my-3" />
            <Label className="cursor-pointer text-xs font-normal">
              <Checkbox
                checked={onlyWithStack}
                onCheckedChange={(v) => onOnlyWithStackChange(v === true)}
              />
              {t("logs.filters.onlyWithStack")}
            </Label>
            {extraCount > 0 && (
              <Button
                size="xs"
                variant="ghost"
                className="mt-3 w-full"
                onClick={() => {
                  onEventTypesChange(new Set())
                  onOnlyWithStackChange(false)
                }}
              >
                {t("logs.filters.reset")}
              </Button>
            )}
          </PopoverContent>
        </Popover>

      </div>
    </div>
  )
}
