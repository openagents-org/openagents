import React from "react"
import { SlidersHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Checkbox } from "@renderer/components/ui/checkbox"
import { Badge } from "@renderer/components/ui/badge"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@renderer/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@renderer/components/ui/toggle-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover"
import {
  SelectGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Separator } from "@renderer/components/ui/separator"
import { SearchInput } from "@renderer/components/ui-kit"
import { LEVEL_DOT } from "@renderer/components/logs/LogLevelBadge"
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
            <SelectGroup>
              <SelectItem value={ALL_AGENTS}>{t("logs.allAgents")}</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.name} value={a.name}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectGroup>
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
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          aria-label={t("logs.columns.level")}
          value={allLevels ? "all" : levels.size === 1 ? [...levels][0] : ""}
          // Clicking the chosen level again reports "": that widens back to
          // everything, as picking "all" does.
          onValueChange={(v) =>
            !v || v === "all" ? onLevelsChange(new Set(LEVEL_ORDER)) : pickLevel(v as LogLevel)
          }
        >
          <ToggleGroupItem value="all">{t("logs.levels.all")}</ToggleGroupItem>
          {LEVEL_ORDER.map((level) => (
            <ToggleGroupItem
              key={level}
              value={level}
              title={t("logs.levelCount", { count: levelCounts[level] })}
            >
              <span className={cn("size-2 rounded-full", LEVEL_DOT[level])} />
              {/* Same keys the table badge and the timeline read, so the three
                  places a level is named can never drift apart. */}
              {t(`logs.levels.${level}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <SlidersHorizontal data-icon="inline-start" />
              {t("logs.actions.moreFilters")}
              {extraCount > 0 && <Badge className="tabular-nums">{extraCount}</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56">
            <FieldSet>
              <FieldLegend variant="label">{t("logs.filters.eventType")}</FieldLegend>
              <FieldGroup data-slot="checkbox-group" className="gap-2">
                {EVENT_TYPES.map((type) => (
                  <Field key={type} orientation="horizontal">
                    <Checkbox
                      id={`logs-event-${type}`}
                      checked={eventTypes.has(type)}
                      onCheckedChange={() => toggleEventType(type)}
                    />
                    <FieldLabel htmlFor={`logs-event-${type}`} className="font-normal">
                      {t(`logs.eventType.${type}`)}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
            <Separator />
            <Field orientation="horizontal">
              <Checkbox
                id="logs-only-stack"
                checked={onlyWithStack}
                onCheckedChange={(v) => onOnlyWithStackChange(v === true)}
              />
              <FieldLabel htmlFor="logs-only-stack" className="font-normal">
                {t("logs.filters.onlyWithStack")}
              </FieldLabel>
            </Field>
            {extraCount > 0 && (
              <Button
                size="xs"
                variant="ghost"
                className="w-full"
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
