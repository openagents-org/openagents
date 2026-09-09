import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { RefreshCw, Layers } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@renderer/components/ui/sidebar"
import { useAccountStore } from "@renderer/store/account"
import { useUiStore } from "@renderer/store/ui"
import { accountError } from "@renderer/lib/account-errors"
import { capture } from "@renderer/lib/analytics"
import type { AccountWorkspace } from "@renderer/types"

/**
 * My Workspaces — the ACCOUNT scope of the rail.
 *
 * These are the workspaces the signed-in user is a member of, from
 * GET /v1/account/workspaces. The device scope — which workspaces may run
 * agents on this machine — is a different list and lives under My Agents, so
 * the two are never presented as one thing that happens to disagree.
 */
export function SidebarWorkspaces(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    account,
    ready,
    workspaces,
    loading,
    error,
    active,
    setActive,
    refresh,
  } = useAccountStore(
    useShallow((s) => ({
      account: s.account,
      ready: s.ready,
      workspaces: s.workspaces,
      loading: s.workspacesLoading,
      error: s.error,
      active: s.active,
      setActive: s.setActive,
      refresh: s.refreshWorkspaces,
    })),
  )
  const { currentTab, setCurrentTab } = useUiStore(
    useShallow((s) => ({
      currentTab: s.currentTab,
      setCurrentTab: s.setCurrentTab,
    })),
  )

  // The list belongs to the account: fetch it once there is one, and again
  // whenever a different account signs in.
  React.useEffect(() => {
    if (account) void refresh()
  }, [account?.email, refresh])

  const open = (workspace: AccountWorkspace): void => {
    capture("workspace_opened", { role: workspace.role })
    setActive(workspace)
    setCurrentTab("workspace")
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-3xs font-semibold tracking-wider text-sidebar-muted uppercase">
        {t("account.workspaces.title")}
      </SidebarGroupLabel>
      {account && (
        <SidebarGroupAction
          title={t("account.workspaces.refresh")}
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </SidebarGroupAction>
      )}

      <SidebarGroupContent>
        <SidebarMenu className="group-data-[collapsible=icon]:items-center">
          {!account && (
            <SidebarMenuItem>
              {/* Says why the list is empty, and nothing more: signing in
                  belongs to the account row at the foot of the rail, and two
                  controls doing the same thing read as two different things.
                  Hidden until the first read from main lands — a sign-in
                  prompt that flashes before a stored session arrives would be
                  a lie for one frame. */}
              <p
                className={`px-2 py-1 text-2xs text-sidebar-muted group-data-[collapsible=icon]:hidden ${
                  ready ? "" : "invisible"
                }`}
                data-testid="workspaces-signed-out"
              >
                {t("account.workspaces.signInToSee")}
              </p>
            </SidebarMenuItem>
          )}

          {account && loading && workspaces.length === 0 && (
            <>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            </>
          )}

          {account && !loading && workspaces.length === 0 && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => void refresh()}
                tooltip={error ? accountError(error, t) : t("account.workspaces.empty")}
              >
                <Layers />
                <span>
                  {error
                    ? t("account.workspaces.loadFailed")
                    : t("account.workspaces.empty")}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {workspaces.map((workspace) => (
            <SidebarMenuItem key={workspace.workspaceId}>
              <SidebarMenuButton
                isActive={
                  currentTab === "workspace" &&
                  active?.workspaceId === workspace.workspaceId
                }
                onClick={() => open(workspace)}
                title={workspace.name}
                tooltip={workspace.name}
              >
                <Layers />
                <span className="truncate">{workspace.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
