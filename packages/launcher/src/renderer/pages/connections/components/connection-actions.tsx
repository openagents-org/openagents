import React from "react"
import { MoreHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import type { PlatformDef } from "@renderer/components/connections/platforms"
import type { ConnectionRecord } from "@renderer/types"

interface Props {
  platform: PlatformDef
  connection: ConnectionRecord | null
  busy: boolean
  /** Platform has a hosted MCP endpoint the launcher can register. */
  hasMcp: boolean
  onConnect: () => void
  onTest: () => void
  onDisconnect: () => void
  onApplyToAgents: () => void
  onConfigureMcp: () => void
}

/**
 * The row's action cell: an optional primary button, then the overflow menu.
 *
 * Every row ends with a real menu — never a spacer standing in for one — so
 * the column has one true right edge and the buttons all stop on the same
 * line. Each state has something worth putting in the menu (at minimum the
 * platform's own docs), so no row is left with a dead control.
 */
export function ConnectionActions({
  platform,
  connection,
  busy,
  hasMcp,
  onConnect,
  onTest,
  onDisconnect,
  onApplyToAgents,
  onConfigureMcp,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const connected = connection?.status === "connected"
  // A platform whose integration isn't finished gets no button: the "coming
  // soon" badge beside its name already explains why, and a disabled control
  // in every second row is what made this column read as noise.
  const locked = platform.support === "planned" && !connection

  return (
    <div className="flex items-center justify-center gap-1">
      {locked ? null : !connected ? (
        <Button size="xs" onClick={onConnect} disabled={busy}>
          {t(
            connection
              ? "connections.card.reconfigure"
              : "connections.card.connect",
          )}
        </Button>
      ) : hasMcp ? (
        <Button size="xs" variant="outline" onClick={onConfigureMcp} disabled={busy}>
          {t("connections.card.configureMcp")}
        </Button>
      ) : platform.defaultEnvKey ? (
        <Button size="xs" variant="outline" onClick={onApplyToAgents} disabled={busy}>
          {t("connections.card.applyToAgents")}
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={busy}
            title={t("connections.card.more")}
            aria-label={t("connections.card.more")}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {connected && hasMcp && platform.defaultEnvKey && (
            <DropdownMenuItem onSelect={onApplyToAgents}>
              {t("connections.card.applyToAgents")}
            </DropdownMenuItem>
          )}
          {connection && (
            <DropdownMenuItem onSelect={onTest}>
              {t("connections.card.test")}
            </DropdownMenuItem>
          )}
          {connected && (
            <DropdownMenuItem onSelect={onConnect}>
              {t("connections.card.reconfigure")}
            </DropdownMenuItem>
          )}
          {platform.docs && (
            <DropdownMenuItem
              onSelect={() => window.api.openExternal(platform.docs!)}
            >
              {t("common.documentation")}
            </DropdownMenuItem>
          )}
          {connection && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDisconnect}>
                {t("connections.card.disconnect")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
