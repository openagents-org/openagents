import React, { useEffect, useState } from "react"
import { KeyRound, Terminal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { CliLoginBlock } from "@renderer/components/agent-auth/auth-status"
import { useCliLogin } from "@renderer/components/agent-auth/use-cli-login"
import { Card } from "@renderer/components/ui/card"
import { Skeleton } from "@renderer/components/ui/skeleton"
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
  /**
   * Whether `fields` is this agent's answer yet. The login command comes off
   * the catalog entry the page was opened with, but the env fields arrive over
   * IPC — so an empty `fields` means "not read yet" just as often as it means
   * "this agent has no key", and the two ask for opposite layouts.
   */
  envLoaded: boolean
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
  envLoaded,
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

  // Which shape this card takes — a sign-in block, a key form, or both behind
  // tabs — is decided by `fields`, which is still empty while the IPC is in
  // flight. Drawing on that emptiness gave a dual-auth agent its sign-in block
  // with no tab strip at all, and then re-laid the card out underneath one a
  // moment later: the user's first look at the page said the agent had only a
  // CLI login. Hold the shape until the fields are in.
  if (!envLoaded)
    return (
      <Card className="gap-4 px-5 py-5">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </Card>
    )

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
      // This card renders BEFORE the install on this page, and signing in
      // needs a binary that isn't there yet — the attempt fails with "install
      // it from the marketplace", which is this very page. The API-key tab
      // stays usable: it only writes config, so configuring ahead of the
      // install works and the setup wizard reads those saved values back.
      notInstalled={!installed}
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
