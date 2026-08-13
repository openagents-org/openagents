import React from "react"
import { ExternalLink, Layers, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { EmptyState } from "@renderer/components/ui-kit"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import type { Agent, Workspace } from "@renderer/types"

import { workspaceName } from "../recent"

const COLUMNS = ["workspace", "agents", "lastUsed", "actions"] as const

interface Props {
  /** Already ordered by recency and cut to the few the dashboard shows. */
  workspaces: Workspace[]
  agents: Agent[]
  lastUsedAt: Record<string, string>
  onOpen: (ws: Workspace) => void
  onViewAll: () => void
  onCreateFirst: () => void
  /** Workspaces in total, not just the rows shown — gates "View all". */
  total: number
}

export function WorkspacesCard({
  workspaces,
  agents,
  lastUsedAt,
  onOpen,
  onViewAll,
  onCreateFirst,
  total,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  // An agent names its workspace by slug or by id, depending on how it was
  // connected — count both.
  const agentCount = (ws: Workspace): number =>
    agents.filter((a) => a.network === ws.id || a.network === ws.slug).length

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        <h2 className="text-base font-semibold">
          {t("dashboard.workspaces.title")}
        </h2>
        {total > workspaces.length && (
          <Button variant="link" size="sm" onClick={onViewAll}>
            {t("dashboard.workspaces.viewAll")}
          </Button>
        )}
      </div>

      {workspaces.length === 0 ? (
        <div className="border-t">
          <EmptyState
            icon={<Layers />}
            title={t("workspaces.emptyNoneTitle")}
            description={t("dashboard.workspaces.empty")}
            action={{
              label: t("common.actions.addWorkspace"),
              icon: <Plus />,
              onClick: onCreateFirst,
            }}
          />
        </div>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c}
                    className={c === "actions" ? "text-center" : undefined}
                  >
                    {t(`dashboard.workspaces.columns.${c}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((ws) => (
                <TableRow key={ws.id} className="h-16">
                  {/* Same as the agents table: this column takes the leftover
                      width so a long workspace name truncates instead of
                      stretching the table. */}
                  <TableCell className="w-full max-w-0">
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Layers className="size-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <div
                          className="truncate text-sm font-medium"
                          title={workspaceName(ws)}
                        >
                          {workspaceName(ws)}
                        </div>
                        {/* The slug, not the host: every workspace on the same
                            endpoint repeats the same hostname, and two of them
                            can carry the same display name — the slug is what
                            actually tells them apart. Never the token: it is a
                            bearer credential, and "Open" already carries it. */}
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {ws.slug || ws.id}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">
                    {t("dashboard.workspaces.agentCount", {
                      count: agentCount(ws),
                    })}
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">
                    {relativeTimeAgo(t, lastUsedAt[ws.id]) || "—"}
                  </TableCell>

                  <TableCell>
                    <div className="flex justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpen(ws)}
                      >
                        <ExternalLink />
                        {t("dashboard.workspaces.open")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
