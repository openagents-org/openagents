import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { ChevronLeft, Globe } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Separator } from "@renderer/components/ui/separator"
import { Spinner } from "@renderer/components/ui/spinner"
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field"
import { PasswordInput } from "@renderer/components/ui-kit"
import { useAccountStore } from "@renderer/store/account"
import { accountError } from "@renderer/lib/account-errors"
import { capture } from "@renderer/lib/analytics"
import { CaptchaCancelled, useTencentCaptcha } from "@renderer/lib/tencent-captcha"
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
  // Human verification when the account service asks for it; a no-op otherwise.
  const captcha = useTencentCaptcha(creatingAccount ? "register" : "login")

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
      // The "I am human" box (mounted in the form when the service requires
      // it) must be ticked first; tickets are single-use, so reset afterwards.
      let pass
      try {
        pass = await captcha.verify()
      } catch (err) {
        if (!(err instanceof CaptchaCancelled)) setError(accountError(err, t))
        return
      }
      try {
        if (creatingAccount) {
          await signUpWithPassword(email.trim(), password, displayName.trim() || undefined, pass)
          capture("sign_up", { method: "password" })
        } else {
          await signInWithPassword(email.trim(), password, pass)
          capture("sign_in", { method: "password" })
        }
      } finally {
        if (pass) captcha.reset()
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

  const pending = busy || signingIn

  return (
    <div className="flex h-full justify-center overflow-y-auto bg-muted/50 p-8">
      <div className="my-auto w-full max-w-md shrink-0">
        <section className="rounded-lg border bg-card p-10 shadow-xs">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t(creatingAccount ? "account.signUpPage.title" : "account.signInPage.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(creatingAccount ? "account.signUpPage.subtitle" : "account.signInPage.subtitle")}
          </p>

          <form onSubmit={(e) => void submit(e)} className="mt-8 grid gap-5">
            {creatingAccount && (
              <Field>
                <FieldLabel htmlFor="sign-up-name">{t("account.signUpPage.name")}</FieldLabel>
                <Input id="sign-up-name" className="h-11" autoComplete="name" value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)} disabled={pending} />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="sign-in-email">{t("account.signInPage.email")}</FieldLabel>
              <Input
                id="sign-in-email"
                type="email"
                className="h-11"
                autoComplete={creatingAccount ? "email" : "username"}
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("account.signInPage.emailPlaceholder")}
                disabled={pending}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="sign-in-password">{t("account.signInPage.password")}</FieldLabel>
              <PasswordInput
                id="sign-in-password"
                wrapperClassName="h-11"
                autoComplete={creatingAccount ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
                aria-describedby={creatingAccount ? "sign-up-password-hint" : undefined}
              />
              {creatingAccount && <p id="sign-up-password-hint" className="text-3xs leading-relaxed text-muted-foreground">{t("account.signUpPage.passwordHint")}</p>}
            </Field>

            {creatingAccount && (
              <Field>
                <FieldLabel htmlFor="sign-up-confirm">{t("account.signUpPage.confirmPassword")}</FieldLabel>
                <PasswordInput id="sign-up-confirm" wrapperClassName="h-11" autoComplete="new-password" required value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} disabled={pending} />
              </Field>
            )}

            {(error || accountSignInError) && <FieldError>{error || accountError(accountSignInError, t)}</FieldError>}

            {/* Tencent Captcha "I am human" checkbox, mounted here when the service requires it */}
            <div ref={captcha.containerRef} className={captcha.required ? "flex justify-center" : "hidden"} />

            <Button
              type="submit"
              className="mt-1 h-11"
              disabled={pending || !email.trim() || !password || (creatingAccount && !confirmPassword)}
              data-testid="sign-in-submit"
            >
              {busy && <Spinner className="size-3.5" />}
              {t(creatingAccount ? (busy ? "account.signUpPage.creating" : "account.signUpPage.submit") : "account.signInPage.submit")}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />{t("account.signInPage.or")}<Separator className="flex-1" />
          </div>

          {/* Not a lesser option: for a Google or GitHub account this is the only way in. */}
          <Button type="button" variant="outline" className="h-11 w-full" onClick={() => void browserSignIn()} disabled={pending}>
            {signingIn ? <Spinner className="size-3.5" /> : <Globe className="size-4" />}
            {signingIn ? t("account.signingIn") : t(creatingAccount ? "account.signUpPage.browser" : "account.signInPage.browser")}
          </Button>
          <p className="mt-2 text-center text-2xs text-muted-foreground">
            {signingIn ? t("account.signingInHint") : t("account.signInPage.browserHint")}
          </p>
          {creatingAccount && <p className="mt-4 text-center text-3xs text-muted-foreground">{t("account.signUpPage.terms")}</p>}

          <div className="mt-8 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => useAccountStore.getState().showWelcome()}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              data-testid="sign-in-back"
            >
              <ChevronLeft className="size-4" />{t("account.welcome.back")}
            </button>
            <button type="button" onClick={switchMode} disabled={pending}
              className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50">
              {t(creatingAccount ? "account.signInPage.submit" : "account.signInPage.signUp")}
            </button>
          </div>
        </section>
        <p className="mt-6 text-center text-xs text-muted-foreground">{t("account.signInPage.localNoSignIn")}</p>
      </div>
    </div>
  )
}
