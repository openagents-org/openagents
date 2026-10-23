import { useState } from "react"
import { LogOut } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import { useAccountStore } from "@renderer/store/account"

/**
 * The signed-in account, on the title bar while All Workspaces is showing —
 * the page there no longer draws its own header inside the launcher. Kept to
 * plain buttons: a popover from this bar would open under the Workspace view.
 */
export function AccountChip(): React.JSX.Element | null {
  const { t } = useTranslation()
  const account = useAccountStore((s) => s.account)
  const [confirming, setConfirming] = useState(false)
  if (!account) return null

  // The page below asks, in the same dialog as its own Sign out. Only when it
  // is not on screen to ask (still loading, failed) does the launcher ask here.
  const signOut = async (): Promise<void> => {
    const asked = await window.api.requestSignOut().catch(() => false)
    if (!asked) setConfirming(true)
  }

  return (
    <div className="titlebar-no-drag flex min-w-0 items-center gap-2" data-testid="account-chip">
      {/* Drawn as the web app's account avatar is, so both read as one account. */}
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-linear-135 from-[#2F6BFF] to-[#16C79A] text-xs font-bold text-white">
        {(account.email[0] || "?").toUpperCase()}
      </span>
      <span className="max-w-48 truncate text-sm text-muted-foreground" title={account.email}>{account.email}</span>
      <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label={t("account.signOut")} title={t("account.signOut")}
        data-testid="account-sign-out" onClick={() => void signOut()}>
        <LogOut />
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t("account.signOutConfirm.title")}
        description={t("account.signOutConfirm.detail", { email: account.email })}
        confirmLabel={t("account.signOut")}
        onConfirm={() => {
          setConfirming(false)
          void useAccountStore.getState().signOut()
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
