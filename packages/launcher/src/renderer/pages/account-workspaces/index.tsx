import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { RefreshCw } from "lucide-react"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { useAccountStore } from "@renderer/store/account"
import { accountError } from "@renderer/lib/account-errors"
import type { ToastType } from "@renderer/hooks/useToast"
import { AccountMenu } from "./account-menu"
import { WorkspaceCard } from "./workspace-card"

/**
 * My Workspaces — the ACCOUNT scope, as a page.
 *
 * Not the same list as Workspaces under My Agents, and deliberately not merged
 * with it: that one is the DEVICE scope, the workspaces this machine is paired
 * into, which it knows without anyone signing in. This one is "which workspaces
 * am I a member of", which is the account's answer and changes with who is
 * signed in. The two are routinely different — a machine an admin authorized
 * may belong to a workspace the user is not in, and being a member authorizes
 * nothing on this machine.
 *
 * It is where a sign-in lands, because the list is what the user signed in to
 * reach. The hosted app has a page for this too; it is written for a browser
 * visitor, it offers to create workspaces (which happens on openagents.org, not
 * here), and reaching it means loading the whole workspace bundle to render a
 * picker. This one is the same answer in the launcher's own voice, and it can
 * say the one thing the web page cannot: whether THIS MACHINE is in.
 */
export default function AccountWorkspaces({
  showToast,
}: {
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    account,
    workspaces,
    loading,
    error,
    enterWorkspace,
    refresh,
    signOut,
  } = useAccountStore(
    useShallow((s) => ({
      account: s.account,
      workspaces: s.workspaces,
      loading: s.workspacesLoading,
      error: s.error,
      enterWorkspace: s.enterWorkspace,
      refresh: s.refreshWorkspaces,
      signOut: s.signOut,
    })),
  )

  /** Workspace ids this machine is paired into; null until the first read. */
  const [joinedIds, setJoinedIds] = React.useState<Set<string> | null>(null)

  const readDeviceScope = React.useCallback(async (): Promise<void> => {
    try {
      const node = await window.api.getNodeStatus()
      setJoinedIds(new Set((node.workspaces || []).map((w) => w.workspaceId)))
    } catch {
      // Unknown is not "not joined": a failed local read must not tell the user
      // their machine is missing from a workspace it may well be in.
      setJoinedIds(null)
    }
  }, [])

  React.useEffect(() => {
    if (account) void refresh()
  }, [account?.email, refresh])

  React.useEffect(() => {
    void readDeviceScope()
  }, [readDeviceScope, workspaces.length])

  const joinedOf = (id: string): boolean | null =>
    joinedIds === null ? null : joinedIds.has(id)

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("account.workspaces.title")}
        subtitle={t("account.workspaces.pageSubtitle")}
        actions={
          // Two things of different weight, so they do not look alike: refresh
          // is a page control and shrinks to its icon, while the account is who
          // you are and keeps its name. Signing out lives behind that name —
          // it is the only account-level action there is, and it should not sit
          // one slip away from the refresh beside it.
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={loading || !account}
              title={t("account.workspaces.refresh")}
              aria-label={t("account.workspaces.refresh")}
              onClick={() => void refresh()}
            >
              {loading ? (
                <Spinner className="size-3.5" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
            {account && (
              <AccountMenu account={account} onSignOut={() => void signOut()} />
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">
        {!account ? (
          <Empty>{t("account.workspaces.signInToSee")}</Empty>
        ) : loading && workspaces.length === 0 ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : error && workspaces.length === 0 ? (
          <Empty>
            <span className="text-destructive">{accountError(error, t)}</span>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void refresh()}
            >
              {t("account.workspaces.retry")}
            </Button>
          </Empty>
        ) : workspaces.length === 0 ? (
          <Empty>
            <div className="font-medium text-foreground">
              {t("account.workspaces.empty")}
            </div>
            <p className="mt-1 max-w-sm">{t("account.workspaces.emptyHint")}</p>
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {workspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.workspaceId}
                workspace={workspace}
                joined={joinedOf(workspace.workspaceId)}
                onOpen={() => enterWorkspace(workspace)}
                onJoined={() => void readDeviceScope()}
                showToast={showToast}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-2xs text-muted-foreground">
      {children}
    </div>
  )
}
