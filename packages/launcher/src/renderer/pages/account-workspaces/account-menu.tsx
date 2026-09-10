import React from "react"
import { useTranslation } from "react-i18next"
import { LogOut } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import type { AccountInfo } from "@renderer/types"

/**
 * Who is signed in, and the one thing you can do about it.
 *
 * The trigger is the avatar alone. An address like 1014027506@qq.com is most of
 * a header's width and none of its meaning — and spelling it out beside the
 * refresh only to spell it out again inside the menu says it twice and reads
 * once. The name belongs where someone goes looking for it, which is behind the
 * avatar.
 *
 * Signing out is the only account-level action there is, and it is one click
 * from having to sign in again, so it is `destructive` — the entry point to
 * something you would rather not do by accident.
 */
export function AccountMenu({
  account,
  onSignOut,
}: {
  account: AccountInfo
  onSignOut: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = account.displayName || account.email
  const initial = (name || "?").trim().charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title={account.email}
          aria-label={account.email}
          className="rounded-full"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-2xs font-medium text-primary">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {/* What the avatar stands for. Not a menu item — there is nothing to
            pick here, it is the heading the one action below belongs to. */}
        <div className="px-2 py-1.5 leading-tight">
          {account.displayName && (
            <div className="truncate text-xs font-medium">
              {account.displayName}
            </div>
          )}
          <div className="truncate text-2xs text-muted-foreground">
            {account.email}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="text-xs"
          onSelect={onSignOut}
        >
          <LogOut />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
