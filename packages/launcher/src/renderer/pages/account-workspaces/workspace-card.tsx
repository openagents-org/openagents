import React from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight, Laptop, ShieldCheck } from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { accountError } from "@renderer/lib/account-errors"
import { capture } from "@renderer/lib/analytics"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import type { ToastType } from "@renderer/hooks/useToast"
import type { AccountWorkspace } from "@renderer/types"

const ROLE_LABEL: Record<AccountWorkspace["role"], string> = {
  owner: "account.workspaces.roleOwner",
  admin: "account.workspaces.roleAdmin",
  member: "account.workspaces.roleMember",
  viewer: "account.workspaces.roleViewer",
}

/**
 * One workspace this account belongs to.
 *
 * The card carries both scopes at once, which is the thing only the desktop app
 * can show: membership comes from the account (this list), and whether THIS
 * MACHINE may run agents in it is a separate, device-level grant. They are
 * routinely different — the ordinary state right after a first sign-in is
 * member-but-not-joined — and a list that showed only the first would leave the
 * user wondering why the workspace cannot see their machine.
 */
export function WorkspaceCard({
  workspace,
  joined,
  onOpen,
  onJoined,
  showToast,
}: {
  workspace: AccountWorkspace
  /** Whether this machine is paired into the workspace; null while unknown. */
  joined: boolean | null
  onOpen: () => void
  onJoined: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = React.useState(false)

  const canAuthorize = workspace.role === "owner" || workspace.role === "admin"

  const authorize = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.authorizeDevice(workspace.workspaceId)
      capture("device_authorized", { role: workspace.role })
      showToast(t("account.workspaces.authorized", { name: workspace.name }))
      onJoined()
    } catch (err) {
      showToast(accountError(err, t), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-ring/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{workspace.name}</div>
          <div className="truncate text-2xs text-muted-foreground">
            {workspace.slug || workspace.workspaceId}
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0 text-3xs">
          {t(ROLE_LABEL[workspace.role])}
        </Badge>
      </div>

      <div className="text-2xs text-muted-foreground">
        {workspace.lastActivityAt
          ? t("account.workspaces.lastActive", {
              when: relativeTimeAgo(t, workspace.lastActivityAt),
            })
          : t("account.workspaces.neverActive")}
      </div>

      {/* The device scope, and its one action, on a single row.
          "Open workspace" is the same button on every card and belongs in the
          same place on every card — so joining, which only some cards offer and
          only some roles may do, sits up here with the state it changes rather
          than stealing width from it or pushing it down a line. */}
      {joined !== null && (
        <div className="flex min-h-6 items-center gap-1.5 text-2xs text-muted-foreground">
          {joined ? (
            <>
              <ShieldCheck className="size-3.5 shrink-0 text-success" />
              <span>{t("account.workspaces.deviceJoined")}</span>
            </>
          ) : (
            <>
              <Laptop className="size-3.5 shrink-0" />
              <span>{t("account.workspaces.deviceNotJoined")}</span>
              {canAuthorize ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  className="ml-auto h-6 px-2 text-2xs"
                  onClick={() => void authorize()}
                >
                  {busy && <Spinner className="size-3" />}
                  {busy
                    ? t("account.workspaces.authorizing")
                    : t("account.workspaces.authorizeDevice")}
                </Button>
              ) : (
                <span className="truncate">
                  · {t("account.workspaces.authorizeAdminOnly")}
                </span>
              )}
            </>
          )}
        </div>
      )}

      <Button size="sm" className="mt-auto w-full" onClick={onOpen}>
        {t("account.workspaces.open")}
        <ArrowRight className="size-3.5" />
      </Button>
    </div>
  )
}
