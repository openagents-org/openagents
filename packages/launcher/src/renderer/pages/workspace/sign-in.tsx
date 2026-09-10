import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { Globe } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Spinner } from "@renderer/components/ui/spinner"
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field"
import { BrandMark, PasswordInput } from "@renderer/components/ui-kit"
import { useAccountStore } from "@renderer/store/account"
import { accountError } from "@renderer/lib/account-errors"
import { capture } from "@renderer/lib/analytics"

/**
 * The launcher's own sign-in, shown where the workspace will be.
 *
 * The web app's login page was doing this job and it did not belong here: it
 * is written for a visitor to a website, so it offers to go back to the
 * marketing home, and carries a page's worth of layout for two fields. This is
 * the same account, asked for the way an application asks.
 *
 * Two paths, because the account system has two kinds of identity:
 *
 *  - an email and password → the form, answered without leaving the window
 *  - Google / GitHub / Apple → the browser, because those providers refuse to
 *    authenticate inside an application window. That is their rule, and there
 *    is no way around it from this side.
 */
export function WorkspaceSignIn(): React.JSX.Element {
  const { t } = useTranslation()
  const { signInWithPassword, signIn, signingIn } = useAccountStore(
    useShallow((s) => ({
      signInWithPassword: s.signInWithPassword,
      signIn: s.signIn,
      signingIn: s.signingIn,
    })),
  )

  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      await signInWithPassword(email.trim(), password)
      capture("sign_in", { method: "password" })
      setPassword("")
    } catch (err) {
      setError(accountError(err, t))
    } finally {
      setBusy(false)
    }
  }

  const browserSignIn = async (): Promise<void> => {
    setError(null)
    const ok = await signIn()
    if (ok) {
      capture("sign_in", { method: "browser" })
      return
    }
    setError(accountError(useAccountStore.getState().error, t))
    useAccountStore.getState().clearError()
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-10" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {t("account.signInPage.title")}
            </h1>
            <p className="mt-1 text-2xs text-muted-foreground">
              {t("account.signInPage.subtitle")}
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="sign-in-email">
              {t("account.signInPage.email")}
            </FieldLabel>
            <Input
              id="sign-in-email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("account.signInPage.emailPlaceholder")}
              disabled={busy || signingIn}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="sign-in-password">
              {t("account.signInPage.password")}
            </FieldLabel>
            <PasswordInput
              id="sign-in-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || signingIn}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>

          <Button
            type="submit"
            disabled={busy || signingIn || !email.trim() || !password}
            data-testid="sign-in-submit"
          >
            {busy && <Spinner className="size-3.5" />}
            {t("account.signInPage.submit")}
          </Button>
        </form>

        {/* Not a lesser option in a footer: for a Google or GitHub account this
            is the only way in. */}
        <div className="mt-6 border-t pt-5">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void browserSignIn()}
            disabled={busy || signingIn}
          >
            {signingIn ? <Spinner className="size-3.5" /> : <Globe className="size-3.5" />}
            {signingIn ? t("account.signingIn") : t("account.signInPage.browser")}
          </Button>
          <p className="mt-2 text-center text-3xs text-muted-foreground">
            {signingIn
              ? t("account.signingInHint")
              : t("account.signInPage.browserHint")}
          </p>
        </div>
      </div>
    </div>
  )
}
