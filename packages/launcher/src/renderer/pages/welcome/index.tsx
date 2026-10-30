import { ArrowRight, KeyRound } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@renderer/components/ui/button"
import { useAccountStore } from "@renderer/store/account"
import { useUiStore } from "@renderer/store/ui"
import { useThemeStore } from "@renderer/store/theme"
import { BrandWordmark } from "@renderer/components/ui-kit"
import previewEnLight from "./assets/workspace-en-light.png"
import previewEnDark from "./assets/workspace-en-dark.png"
import previewZhLight from "./assets/workspace-zh-light.png"
import previewZhDark from "./assets/workspace-zh-dark.png"

/**
 * The signed-out Workspace offers two ways forward. The pairing code leads,
 * since most people arrive from the web already holding one, and the pairing
 * dialog tells everyone else where to get it. Signing in comes second: it is
 * what opens workspaces here in the app instead of in the browser.
 */
export default function WelcomePage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const theme = useThemeStore((s) => s.resolved)
  const preview = i18n.language.startsWith("zh")
    ? theme === "dark" ? previewZhDark : previewZhLight
    : theme === "dark" ? previewEnDark : previewEnLight
  // Connected Workspaces, with its pairing-code dialog open.
  const joinWithCode = (): void => {
    useAccountStore.getState().exitWorkspace()
    useUiStore.getState().requestCreate("workspace")
  }

  return (
    <main className="h-full overflow-y-auto bg-background" data-testid="app-welcome">
      {/* One centred container owns the column gap, and keeps it narrow: the
          copy column is sized to its buttons, so any blank band between it and
          the preview reads as a hole, while the outer margins carry the air. */}
      <div className="mx-auto grid min-h-full w-full max-w-7xl items-center gap-10 px-10 py-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-6 xl:px-16">
        <section className="flex min-h-[36rem] flex-col justify-center">
          <BrandWordmark className="mb-12 h-auto w-72" />
          <h1 className="m-0 text-3xl leading-tight font-bold tracking-tight text-foreground xl:text-4xl">{t("account.welcome.title")}</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">{t("account.welcome.description")}</p>
          <div className="mt-8 flex flex-col gap-3">
            <Button className="h-11 w-full" onClick={joinWithCode} data-testid="welcome-join-code">
              <KeyRound className="size-4" />{t("account.welcome.joinWithCode")}
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => useAccountStore.getState().openSignIn()}
              data-testid="welcome-sign-in"
            >
              {t("account.welcome.signIn")} <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
        <section className="hidden min-w-0 flex-col justify-center lg:flex" aria-label={t("account.welcome.previewLabel")}>
          <figure className="m-0">
            {/* Generated from the shared web app. See scripts/render-workspace-preview.mjs. */}
            <div className="overflow-hidden rounded-xl border border-border/80 bg-background shadow-lg">
              <img src={preview} width={2240} height={1560} className="block h-auto w-full select-none" alt={t("account.welcome.previewLabel")} draggable={false} />
            </div>
            <figcaption className="mt-4 text-center text-xs text-muted-foreground">{t("account.welcome.previewCaption")}</figcaption>
          </figure>
        </section>
      </div>
    </main>
  )
}
