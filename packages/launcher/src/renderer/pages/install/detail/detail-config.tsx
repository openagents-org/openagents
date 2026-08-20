import React, { useEffect, useState } from "react"
import { KeyRound, Terminal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { CliLoginBlock } from "@renderer/components/agent-auth/auth-status"
import { useCliLogin } from "@renderer/components/agent-auth/use-cli-login"
import { Card } from "@renderer/components/ui/card"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs"
import type { EnvField } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

import { DetailKeyForm } from "./detail-key-form"

interface Props {
  agentName: string
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  /** Non-null when the agent can sign in through its own CLI. */
  loginCommand: string | null
  /** Whether the CLI is on disk — a sign-in probe is only answerable if it is. */
  installed: boolean
  /**
   * Bumped whenever something outside this card may have changed the sign-in
   * (today: the setup wizard closing). The in-app login broadcasts its own
   * success to every card, but the terminal fallback reports nothing back.
   */
  authRefresh?: number
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * How this agent authenticates, on its marketplace page: a CLI sign-in, an API
 * key, or — for the agents that take either (Claude, Codex, Gemini…) — both
 * behind tabs.
 *
 * The page used to render the key fields and nothing else, so an agent whose
 * real auth path is a browser sign-in had no way to reach it from here, and a
 * login-only agent (Cursor, Hermes) got no configuration section at all. Same
 * two paths and the same components as the Configure dialog, so wherever the
 * user lands they see the same choice.
 */
export function DetailConfig({
  agentName,
  fields,
  values,
  onChange,
  loginCommand,
  installed,
  authRefresh = 0,
  showToast,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [loginPhase, setLoginPhase] = useState<
    "idle" | "awaiting" | "checking"
  >("idle")
  const [tab, setTab] = useState<"cli" | "key">(loginCommand ? "cli" : "key")

  const login = useCliLogin({
    agentType: agentName,
    onSuccess: () => void confirmLogin(),
  })

  // A CLI that had to be given a real terminal reports nothing back, so that
  // path keeps the old contract: the user tells us when they're done.
  useEffect(() => {
    if (login.phase === "terminal") setLoginPhase("awaiting")
  }, [login.phase])

  // Probe so the card opens on the truth rather than "not signed in" — and
  // probe AGAIN whenever the answer could have changed.
  //
  // This is the page the install happens on, so the first probe usually runs
  // while the CLI is not on disk yet: `codex login status` can't be spawned,
  // the verdict comes back unknown, and `?? ready` turns that into a flat "not
  // signed in". With the old mount-only effect that verdict then stood for the
  // rest of the visit — the setup wizard on top of this very page would read
  // "signed in" from a fresh probe while the card underneath still said the
  // opposite. Re-running on `installed` covers the install; `authRefresh`
  // covers a sign-in that finished somewhere this card can't hear about (the
  // terminal fallback reports nothing back, unlike the in-app login, whose
  // success event every card receives).
  useEffect(() => {
    if (!loginCommand) return
    // Not on disk ⇒ there is nothing to be signed in to, and spawning a probe
    // would only burn its timeout. Say so instead of spinning.
    if (!installed) {
      setLoggedIn(false)
      return
    }
    let cancelled = false
    window.api
      .refreshLogin(agentName)
      .then((h) => {
        if (!cancelled) setLoggedIn(h?.logged_in ?? h?.ready ?? false)
      })
      .catch(() => {
        if (!cancelled) setLoggedIn(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentName, loginCommand, installed, authRefresh])

  async function confirmLogin(): Promise<void> {
    setLoginPhase("checking")
    try {
      const h = await window.api.refreshLogin(agentName)
      const ok = h?.logged_in ?? h?.ready ?? false
      setLoggedIn(ok)
      showToast(
        ok
          ? t("agents.configureDialog.toast.signedInReady")
          : t("agents.configureDialog.toast.couldntConfirm"),
        ok ? "success" : "warning",
      )
    } catch {
      setLoggedIn(false)
      showToast(t("agents.configureDialog.toast.couldntReadStatus"), "error")
    } finally {
      setLoginPhase("idle")
    }
  }

  if (fields.length === 0 && !loginCommand) return null

  const cliBlock = loginCommand ? (
    <CliLoginBlock
      agentType={agentName}
      loginCmd={loginCommand}
      loginPhase={loginPhase}
      loggedIn={loggedIn}
      login={login}
      onStartLogin={(opts) => void login.start(opts)}
      onConfirmLogin={confirmLogin}
      onCancelAwaiting={() => setLoginPhase("idle")}
    />
  ) : null

  const keyForm = (
    <DetailKeyForm
      agentName={agentName}
      fields={fields}
      values={values}
      onChange={onChange}
      showToast={showToast}
    />
  )

  return (
    <Card className="gap-4 px-5 py-5">
      {cliBlock && fields.length > 0 ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "cli" | "key")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="cli" className="text-xs">
              <Terminal />
              {t("agents.list.health.cliLogin")}
            </TabsTrigger>
            <TabsTrigger value="key" className="text-xs">
              <KeyRound />
              {t("agents.list.health.apiKey")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="cli" className="pt-1">
            {cliBlock}
          </TabsContent>
          <TabsContent value="key" className="pt-1">
            {keyForm}
          </TabsContent>
        </Tabs>
      ) : (
        (cliBlock ?? keyForm)
      )}
    </Card>
  )
}
