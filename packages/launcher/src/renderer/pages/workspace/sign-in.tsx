import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Globe } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Spinner } from "@renderer/components/ui/spinner"
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field"
import { BrandMark, PasswordInput } from "@renderer/components/ui-kit"
import { useAccountStore } from "@renderer/store/account"
import { accountError } from "@renderer/lib/account-errors"
import { capture } from "@renderer/lib/analytics"
import { registrationPasswordError } from "../../../shared/account-registration"

/** Email accounts use the account service in-app; OAuth uses the browser. */
export function WorkspaceSignIn(): React.JSX.Element {
  const { t } = useTranslation()
  const { signInWithPassword, signUpWithPassword, signIn, signingIn, authMode, openSignIn, openSignUp, accountSignInError } = useAccountStore(
    useShallow((s) => ({
      signInWithPassword: s.signInWithPassword,
      signUpWithPassword: s.signUpWithPassword,
      signIn: s.signIn,
      signingIn: s.signingIn,
      authMode: s.authMode,
      openSignIn: s.openSignIn,
      openSignUp: s.openSignUp,
      accountSignInError: s.error,
    })),
  )

  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const creatingAccount = authMode === "sign-up"

  const switchMode = (): void => {
    setPassword("")
    setConfirmPassword("")
    setError(null)
    if (creatingAccount) openSignIn()
    else openSignUp()
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || signingIn || !email.trim() || !password) return
    if (creatingAccount) {
      const passwordError = registrationPasswordError(password)
      if (passwordError) {
        setError(accountError(passwordError, t))
        return
      }
      if (password !== confirmPassword) {
        setError(t("account.signUpPage.passwordMismatch"))
        return
      }
    }
    setBusy(true)
    setError(null)
    useAccountStore.getState().clearError()
    try {
      if (creatingAccount) {
        await signUpWithPassword(email.trim(), password, displayName.trim() || undefined)
        capture("sign_up", { method: "password" })
      } else {
        await signInWithPassword(email.trim(), password)
        capture("sign_in", { method: "password" })
      }
      setPassword("")
      setConfirmPassword("")
    } catch (err) {
      if ((err as Error)?.message?.includes("SIGN_UP_SESSION_FAILED")) {
        openSignIn()
        setPassword("")
        setConfirmPassword("")
      }
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
    <div className="flex h-full justify-center overflow-y-auto p-8">
      <div className="my-auto w-full max-w-sm shrink-0">
        <button
          type="button"
          onClick={() => useAccountStore.getState().showWelcome()}
          className="mb-6 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          data-testid="sign-in-back"
        >
          <ArrowLeft className="size-3.5" />{t("account.welcome.back")}
        </button>
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-10" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {t(creatingAccount ? "account.signUpPage.title" : "account.signInPage.title")}
            </h1>
            <p className="mt-1 text-2xs text-muted-foreground">
              {t(creatingAccount ? "account.signUpPage.subtitle" : "account.signInPage.subtitle")}
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          {creatingAccount && (
            <Field>
              <FieldLabel htmlFor="sign-up-name">{t("account.signUpPage.name")}</FieldLabel>
              <Input id="sign-up-name" autoComplete="name" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} disabled={busy || signingIn} />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="sign-in-email">
              {t("account.signInPage.email")}
            </FieldLabel>
            <Input
              id="sign-in-email"
              type="email"
              autoComplete={creatingAccount ? "email" : "username"}
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
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
              autoComplete={creatingAccount ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || signingIn}
              aria-describedby={creatingAccount ? "sign-up-password-hint" : undefined}
            />
            {creatingAccount && <p id="sign-up-password-hint" className="text-3xs leading-relaxed text-muted-foreground">{t("account.signUpPage.passwordHint")}</p>}
          </Field>

          {creatingAccount && (
            <Field>
              <FieldLabel htmlFor="sign-up-confirm">{t("account.signUpPage.confirmPassword")}</FieldLabel>
              <PasswordInput id="sign-up-confirm" autoComplete="new-password" required value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} disabled={busy || signingIn} />
            </Field>
          )}

          {(error || accountSignInError) && <FieldError>{error || accountError(accountSignInError, t)}</FieldError>}

          <Button
            type="submit"
            disabled={busy || signingIn || !email.trim() || !password || (creatingAccount && !confirmPassword)}
            data-testid="sign-in-submit"
          >
            {busy && <Spinner className="size-3.5" />}
            {t(creatingAccount ? (busy ? "account.signUpPage.creating" : "account.signUpPage.submit") : "account.signInPage.submit")}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t(creatingAccount ? "account.signUpPage.hasAccount" : "account.signInPage.noAccount")}{" "}
          <button type="button" onClick={switchMode} disabled={busy || signingIn}
            className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50">
            {t(creatingAccount ? "account.signInPage.submit" : "account.signInPage.signUp")}
          </button>
        </p>
        {creatingAccount && <p className="mt-3 text-center text-3xs text-muted-foreground">{t("account.signUpPage.terms")}</p>}

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
            {signingIn ? t("account.signingIn") : t(creatingAccount ? "account.signUpPage.browser" : "account.signInPage.browser")}
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
