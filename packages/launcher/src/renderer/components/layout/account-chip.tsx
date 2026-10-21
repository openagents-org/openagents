import { LogOut } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { useAccountStore } from "@renderer/store/account"

/**
 * The signed-in account, on the title bar while All Workspaces is showing —
 * the page there no longer draws its own header inside the launcher. Kept to
 * plain buttons: a popover from this bar would open under the Workspace view.
 */
export function AccountChip(): React.JSX.Element | null {
  const { t } = useTranslation()
  const account = useAccountStore((s) => s.account)
  if (!account) return null

  return (
    <div className="titlebar-no-drag flex min-w-0 items-center gap-2" data-testid="account-chip">
      {/* Drawn as the web app's account avatar is, so both read as one account. */}
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-linear-135 from-[#2F6BFF] to-[#16C79A] text-xs font-bold text-white">
        {(account.email[0] || "?").toUpperCase()}
      </span>
      <span className="truncate text-sm text-muted-foreground" title={account.email}>{account.email}</span>
      <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label={t("account.signOut")} title={t("account.signOut")}
        data-testid="account-sign-out" onClick={() => void useAccountStore.getState().signOut()}>
        <LogOut />
      </Button>
    </div>
  )
}
