import { ArrowRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@renderer/components/ui/button"
import { useAccountStore } from "@renderer/store/account"
import { useUiStore } from "@renderer/store/ui"
import { useThemeStore } from "@renderer/store/theme"
import logoLight from "./assets/openagents-logo-light.png"
import logoDark from "./assets/openagents-logo-dark.png"
import previewEnLight from "./assets/workspace-en-light.png"
import previewEnDark from "./assets/workspace-en-dark.png"
import previewZhLight from "./assets/workspace-zh-light.png"
import previewZhDark from "./assets/workspace-zh-dark.png"

/**
 * The signed-out Workspace. One way forward: the pairing code. People arriving
 * from the web already hold one, and the pairing dialog itself tells everyone
 * else where to get it — so the button skips sign-in and goes straight there.
 * Local tools stay a click away in This Computer.
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
    <main className="grid h-full overflow-y-auto bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" data-testid="app-welcome">
      <section className="flex min-h-[36rem] flex-col justify-center px-10 py-12 xl:px-16">
        {/* The full wordmark carries black lettering, so dark mode swaps in a
            copy with the lettering in white. */}
        <img
          src={theme === "dark" ? logoDark : logoLight}
          width={936}
          height={153}
          className="mb-12 block h-auto w-72 select-none"
          alt="OpenAgents"
          draggable={false}
        />
        <h1 className="m-0 text-3xl leading-tight font-bold tracking-tight text-foreground xl:text-4xl">{t("account.welcome.title")}</h1>
        <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">{t("account.welcome.description")}</p>
        <div className="mt-8 max-w-sm">
          <Button className="h-11 w-full" onClick={joinWithCode} data-testid="welcome-join-code">
            {t("account.welcome.start")} <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>
      <section className="hidden min-w-0 flex-col justify-center px-6 py-12 lg:flex xl:pr-10" aria-label={t("account.welcome.previewLabel")}>
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
