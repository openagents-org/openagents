import React from "react"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { PAGE_SIZES } from "../use-agents-view"

interface Props {
  total: number
  page: number
  pageCount: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
}

export function AgentsPagination({
  total,
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mt-3 flex items-center justify-between gap-4 text-2xs text-muted-foreground">
      <span>{t("agents.list.totalCount", { count: total })}</span>

      <div className="flex items-center gap-2">
        <span>{t("agents.list.perPage")}</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            onPageSize(Number(v))
            onPage(1)
          }}
        >
          <SelectTrigger size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="icon-sm"
          variant="outline"
          disabled={page <= 1}
          aria-label={t("agents.list.prevPage")}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center tabular-nums">
          {t("agents.list.pageOf", { page, pageCount })}
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          disabled={page >= pageCount}
          aria-label={t("agents.list.nextPage")}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
