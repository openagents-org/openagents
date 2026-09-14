import { ArrowRight, KeyRound } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@renderer/components/ui/button"
import { BrandMark } from "@renderer/components/ui-kit"
import { useAccountStore } from "@renderer/store/account"
import { useUiStore } from "@renderer/store/ui"
import { useThemeStore } from "@renderer/store/theme"
import previewEnLight from "./assets/workspace-en-light.png"
import previewEnDark from "./assets/workspace-en-dark.png"
import previewZhLight from "./assets/workspace-zh-light.png"
import previewZhDark from "./assets/workspace-zh-dark.png"

/**
 * The signed-out Workspace. Sign in to work in a workspace; a server or remote
 * machine that only needs to join one goes straight to the pairing code, which
 * needs no account. Local tools stay a click away in This Computer.
 */
export default function WelcomePage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const theme = useThemeStore((s) => s.resolved)
  const preview = i18n.language.startsWith("zh")
    ? theme === "dark" ? previewZhDark : previewZhLight
    : theme === "dark" ? previewEnDark : previewEnLight
  const openSignIn = useAccountStore((s) => s.openSignIn)
  const openSignUp = useAccountStore((s) => s.openSignUp)
  const signingIn = useAccountStore((s) => s.signingIn)
  // Connected Workspaces, with its pairing-code dialog open.
  const joinWithCode = (): void => {
    useAccountStore.getState().exitWorkspace()
    useUiStore.getState().requestCreate("workspace")
  }

  return (
    <main className="grid h-full overflow-y-auto bg-background lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]" data-testid="app-welcome">
      <section className="flex min-h-[36rem] flex-col justify-center px-10 py-12 xl:px-20">
        <div className="mb-14 flex items-center gap-3 text-lg font-semibold tracking-tight">
          <BrandMark className="size-8" /> OpenAgents
        </div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("account.welcome.kicker")}</p>
        <h1 className="mt-5 max-w-lg text-4xl leading-tight font-semibold tracking-tight">{t("account.welcome.title")}</h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">{t("account.welcome.description")}</p>
        <div className="mt-8 max-w-sm">
          <Button className="h-11 w-full" onClick={openSignIn} data-testid="welcome-sign-in">
            {t("account.welcome.signIn")} <ArrowRight className="size-4" />
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("account.welcome.newHere")}{" "}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline disabled:opacity-50"
              onClick={openSignUp}
              disabled={signingIn}
            >{t("account.welcome.createAccount")}</button>
          </p>
          <div className="mt-8 border-t pt-5">
            <Button variant="ghost" className="h-auto w-full justify-start px-0 py-3 hover:bg-transparent hover:text-primary" onClick={joinWithCode} data-testid="welcome-join-code">
              <KeyRound className="size-4" /> {t("account.welcome.joinWithCode")} <ArrowRight className="ml-auto size-4" />
            </Button>
            <p className="text-xs leading-6 text-muted-foreground">{t("account.welcome.joinWithCodeHint")}</p>
          </div>
        </div>
      </section>
      <section className="hidden min-w-0 flex-col justify-center px-6 py-12 lg:flex xl:pr-10" aria-label={t("account.welcome.previewLabel")}>
        <div className="mb-6 px-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("account.welcome.previewKicker")}</p>
          <h2 className="mt-3 text-2xl font-medium tracking-tight">{t("account.welcome.previewTitle")}</h2>
        </div>
        <figure className="m-0">
          {/* Generated from the shared web app. See scripts/render-workspace-preview.mjs. */}
          <div className="overflow-hidden rounded-xl border border-border/80 bg-background shadow-lg">
            <img src={preview} width={2240} height={1560} className="block h-auto w-full select-none" alt={t("account.welcome.previewLabel")} draggable={false} />
          </div>
          <figcaption className="mt-4 text-center text-xs text-muted-foreground">{t("account.welcome.previewCaption")}</figcaption>
        </figure>
      </section>
    </main>
  )
}
