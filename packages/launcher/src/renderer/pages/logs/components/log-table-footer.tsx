import React from "react"
import { ChevronLeft, ChevronRight, Rows2, Rows3, Rows4 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { cn } from "@renderer/lib/utils"
import type { Density } from "./log-table"

export const PAGE_SIZES = [25, 50, 100, 200] as const

const DENSITIES: Array<{ key: Density; icon: typeof Rows2 }> = [
  { key: "compact", icon: Rows4 },
  { key: "normal", icon: Rows3 },
  { key: "comfortable", icon: Rows2 },
]

interface Props {
  loaded: number
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  density: Density
  onDensityChange: (density: Density) => void
}

export function LogTableFooter({
  loaded,
  page,
  pageCount,
  onPageChange,
  pageSize,
  onPageSizeChange,
  density,
  onDensityChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-4 py-2.5">
      <span className="text-2xs text-muted-foreground">
        {t("logs.footer.loaded", { count: loaded })}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-2xs text-muted-foreground">
          {t("logs.footer.pageSize")}
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <SelectTrigger size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-2xs text-muted-foreground">
          {t("logs.footer.density")}
        </span>
        <div className="flex items-center gap-0.5 rounded-md border p-0.5">
          {DENSITIES.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onDensityChange(key)}
              title={t(`logs.density.${key}`)}
              className={cn(
                "flex size-6 cursor-pointer items-center justify-center rounded-sm border-0 transition-colors",
                density === key
                  ? "bg-primary/10 text-primary"
                  : "bg-transparent text-muted-foreground hover:bg-accent",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={t("logs.footer.prevPage")}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center text-2xs tabular-nums text-muted-foreground">
          {page} / {pageCount}
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label={t("logs.footer.nextPage")}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
