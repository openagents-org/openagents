import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { LogIn, LogOut, User } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { Spinner } from "@renderer/components/ui/spinner"
import { useSidebar } from "@renderer/components/ui/sidebar"
import { useAccountStore } from "@renderer/store/account"

/**
 * The account row in the rail — one of the two ways into signing in (the other
 * is the My Workspaces group's empty state).
 *
 * Signed out this is a plain button, not a gate: everything under My Agents
 * keeps working untouched, and nothing here is on the path to installing or
 * running an agent.
 */
export function SidebarAccount(): React.JSX.Element {
  const { t } = useTranslation()
  const collapsed = useSidebar().state === "collapsed"
  const { account, signingIn, openSignIn, cancelSignIn, signOut } = useAccountStore(
    useShallow((s) => ({
      account: s.account,
      signingIn: s.signingIn,
      openSignIn: s.openSignIn,
      cancelSignIn: s.cancelSignIn,
      signOut: s.signOut,
    })),
  )

  if (signingIn) {
    return (
      <button
        type="button"
        onClick={cancelSignIn}
        title={t("account.cancel")}
        className="flex w-full items-center gap-2 rounded-md p-1 text-2xs text-sidebar-muted transition-colors hover:text-sidebar-foreground group-data-[collapsible=icon]:justify-center"
      >
        <span className="flex size-7 shrink-0 items-center justify-center">
          <Spinner className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:hidden">
          {t("account.signingIn")}
        </span>
      </button>
    )
  }

  if (!account) {
    return (
      <button
        type="button"
        onClick={openSignIn}
        title={t("account.signInHint")}
        data-testid="account-sign-in"
        className="flex w-full items-center gap-2 rounded-md p-1 text-2xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-accent">
          <LogIn className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:hidden">
          {t("account.signIn")}
        </span>
      </button>
    )
  }

  const initial = (account.displayName || account.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.menuLabel")}
          title={account.email}
          data-testid="account-menu"
          className="flex w-full items-center gap-2 rounded-md p-1 transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-2xs font-semibold text-sidebar-primary-foreground">
            {initial || <User className="size-3.5" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-2xs font-medium text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            {account.displayName || account.email}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">
          <span className="block truncate">{account.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onSelect={() => void signOut()}>
          <LogOut className="size-3.5" />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
