import React from "react"
import { ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/button"
import type { PlatformDef } from "./platforms"

/**
 * "Connect via browser" — opens the platform's docs/integrations page in
 * the user's default browser. The user then creates a token there and
 * pastes it back into the launcher's paste-token field.
 *
 * This is a stage.md §4.2 stub for the full OAuth callback flow. A real
 * OAuth flow would need: (1) the launcher registering a custom URL scheme,
 * (2) starting a local-loopback HTTP server, or (3) deep-link routing back
 * into the Electron process. All three require infrastructure outside this
 * page's scope.
 */
export function OAuthConnectButton({
  platform,
  size = "sm",
}: {
  platform: PlatformDef
  size?: "sm" | "default"
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!platform.docs && !platform.oauthStart) return null
  const url = platform.oauthStart || platform.docs!
  return (
    <Button
      size={size}
      variant="secondary"
      onClick={() => window.api.openExternal(url)}
      title={t("connections.oauth.openTitle", { platform: platform.label })}
    >
      <ExternalLink />
      {t("connections.oauth.connectViaBrowser")}
    </Button>
  )
}
