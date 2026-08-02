import React from "react"
import { MoreHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../shadcn/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shadcn/dropdown-menu"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord } from "../../types"

interface Props {
  platform: PlatformDef
  connection: ConnectionRecord | null
  busy: boolean
  hasMcp: boolean
  onConnect: () => void
  onReconnect: () => void
  onTest: () => void
  onDisconnect: () => void
  onApplyToAgents: () => void
  onConfigureMcp: () => void
}

/**
 * One row, always. A connected platform has up to five actions and the card's
 * content box is only ~260px wide, so everything past the single most useful
 * action lives behind the ⋯ menu rather than wrapping.
 */
export function PlatformCardActions({
  platform,
  connection,
  busy,
  hasMcp,
  onConnect,
  onReconnect,
  onTest,
  onDisconnect,
  onApplyToAgents,
  onConfigureMcp,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const planned = platform.support === "planned"
  const connected = connection?.status === "connected"

  // A planned platform can't be connected yet, but one that was already
  // connected before it got demoted still needs Test/Disconnect — don't strand
  // the record. Disabled rather than absent, so every card's action row sits at
  // the same weight; the hint explains why it can't be pressed.
  if (planned && !connection) {
    return (
      <Button size="sm" variant="secondary" disabled title={t("connections.card.plannedHint")}>
        {t("connections.card.connect")}
      </Button>
    )
  }

  if (!connection) {
    return (
      <Button size="sm" onClick={onConnect} disabled={busy}>
        {t("connections.card.connect")}
      </Button>
    )
  }

  // What the card is *for* depends on status: a healthy connection wants
  // handing to agents, a broken one wants fixing. Whichever it is gets the one
  // visible button; the rest go in the menu.
  const primary = !connected ? (
    <Button size="sm" onClick={onReconnect} disabled={busy}>
      {t("connections.card.reconfigure")}
    </Button>
  ) : hasMcp ? (
    <Button size="sm" onClick={onConfigureMcp} disabled={busy}>
      {t("connections.card.configureMcp")}
    </Button>
  ) : (
    platform.defaultEnvKey && (
      <Button size="sm" onClick={onApplyToAgents} disabled={busy}>
        {t("connections.card.applyToAgents")}
      </Button>
    )
  )

  return (
    <>
      {primary}
      {/* Pushed to the right edge so the action row echoes the status row above
          it, which is also justified to both edges. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-7"
            disabled={busy}
            title={t("connections.card.more")}
            aria-label={t("connections.card.more")}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Only surfaced here when it isn't already the primary button. */}
          {connected && hasMcp && platform.defaultEnvKey && (
            <DropdownMenuItem onSelect={onApplyToAgents}>
              {t("connections.card.applyToAgents")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onTest}>
            {t("connections.card.test")}
          </DropdownMenuItem>
          {connected && (
            <DropdownMenuItem onSelect={onReconnect}>
              {t("connections.card.reconfigure")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDisconnect}>
            {t("connections.card.disconnect")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
