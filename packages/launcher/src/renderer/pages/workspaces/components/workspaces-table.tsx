import React from "react"
import { useTranslation } from "react-i18next"

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table"
import { cn } from "@renderer/lib/utils"

const COLUMNS = ["workspace", "status", "agents", "lastActive", "actions"] as const

/**
 * The Joined Workspaces list as a table. Rows come from the caller, each
 * saying for itself why it opens only in the browser, if it does.
 */
export function WorkspacesTable({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <TableHead
                key={c}
                className={cn(
                  "px-4 text-xs font-normal text-muted-foreground",
                  c !== "workspace" && "w-px whitespace-nowrap",
                  c === "actions" && "text-right",
                )}
              >
                {t(`workspaces.table.columns.${c}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  )
}
