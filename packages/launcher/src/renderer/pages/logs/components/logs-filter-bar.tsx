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
import { Switch } from "@renderer/components/ui/switch"
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

/** Selected-state tint per level; unselected pills stay neutral. */
const LEVEL_ACTIVE: Record<LogLevel, string> = {
  error: "bg-(--danger-bg) text-(--danger-text)",
  warn: "bg-(--warning-bg) text-(--warning-text)",
  info: "bg-(--info-bg) text-(--info-text)",
  debug: "bg-muted text-foreground",
  trace: "bg-muted text-foreground",
  unknown: "bg-muted text-foreground",
}

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
  live: boolean
  onLiveChange: (v: boolean) => void
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
  live,
  onLiveChange,
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
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <Select
        value={agentFilter || ALL_AGENTS}
        onValueChange={(v) => onAgentFilterChange(v === ALL_AGENTS ? "" : v)}
      >
        <SelectTrigger size="sm" className="w-40">
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

      <SearchInput
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={() => onSearchChange("")}
        placeholder={t("logs.searchPlaceholder")}
        wrapperClassName="w-full max-w-96 flex-1"
      />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onLevelsChange(new Set(LEVEL_ORDER))}
          className={cn(
            "cursor-pointer rounded-md border-0 px-2.5 py-1 text-xs font-medium transition-colors",
            allLevels
              ? "bg-primary/10 text-primary"
              : "bg-transparent text-muted-foreground hover:bg-accent",
          )}
        >
          {t("logs.levels.all")}
        </button>
        {LEVEL_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => pickLevel(level)}
            title={t("logs.levelCount", { count: levelCounts[level] })}
            className={cn(
              "cursor-pointer rounded-md border-0 px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              levels.has(level) && !allLevels
                ? LEVEL_ACTIVE[level]
                : "bg-transparent text-muted-foreground hover:bg-accent",
            )}
          >
            {level}
          </button>
        ))}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
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
              <Label
                key={type}
                className="cursor-pointer text-xs font-normal"
              >
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

      <Label className="ml-1 cursor-pointer gap-2 text-xs font-normal text-muted-foreground">
        {t("logs.actions.live")}
        <Switch checked={live} onCheckedChange={onLiveChange} />
      </Label>
    </div>
  )
}
