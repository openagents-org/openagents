import React from "react"
import { Copy, Download, RefreshCw, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Checkbox } from "@renderer/components/ui/checkbox"
import { Label } from "@renderer/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { SearchInput } from "@renderer/components/ui-kit"
import { LogLevelBadge } from "@renderer/components/logs/LogLevelBadge"
import { cn } from "@renderer/lib/utils"
import type { LogLevel } from "@renderer/services/logs/log-parser"
import type { Agent } from "@renderer/types"
import { LEVEL_ORDER } from "../use-logs"

/** Sentinel for "no agent filter" — Radix Select forbids an empty item value. */
export const ALL_AGENTS = "__all__"

interface Props {
  agents: Agent[]
  agentFilter: string
  onAgentFilterChange: (v: string) => void
  search: string
  onSearchChange: (v: string) => void
  enabledLevels: Set<LogLevel>
  onToggleLevel: (l: LogLevel) => void
  levelCounts: Record<LogLevel, number>
  autoRefresh: boolean
  onAutoRefreshChange: (v: boolean) => void
  onRefresh: () => void
  onCopy: () => void
  onExport: () => void
  onClear: () => void
}

export function LogsToolbar({
  agents,
  agentFilter,
  onAgentFilterChange,
  search,
  onSearchChange,
  enabledLevels,
  onToggleLevel,
  levelCounts,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onCopy,
  onExport,
  onClear,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select
        value={agentFilter || ALL_AGENTS}
        onValueChange={(v) => onAgentFilterChange(v === ALL_AGENTS ? "" : v)}
      >
        <SelectTrigger size="sm" className="w-45">
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
        wrapperClassName="w-60"
      />

      <div className="flex items-center gap-1">
        {LEVEL_ORDER.map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => onToggleLevel(lvl)}
            className={cn(
              "cursor-pointer rounded-sm border-0 bg-transparent transition-opacity",
              enabledLevels.has(lvl) ? "opacity-100" : "opacity-35",
            )}
            title={t("logs.toggleLevel", { level: lvl })}
          >
            <LogLevelBadge level={lvl} />
            <span className="ml-1 text-3xs text-muted-foreground">
              {levelCounts[lvl]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <Button size="sm" variant="outline" onClick={onRefresh}>
        <RefreshCw />
        {t("logs.actions.refresh")}
      </Button>
      <Button size="sm" variant="outline" onClick={onCopy} title={t("logs.actions.copy")}>
        <Copy />
        {t("logs.actions.copy")}
      </Button>
      <Button size="sm" variant="outline" onClick={onExport}>
        <Download />
        {t("logs.actions.export")}
      </Button>
      <Button size="sm" variant="destructive" onClick={onClear}>
        <Trash2 />
        {t("logs.actions.clear")}
      </Button>

      <Label className="ml-1 cursor-pointer text-xs font-normal text-muted-foreground">
        <Checkbox
          checked={autoRefresh}
          onCheckedChange={(v) => onAutoRefreshChange(v === true)}
        />
        {t("logs.actions.auto")}
      </Label>
    </div>
  )
}
