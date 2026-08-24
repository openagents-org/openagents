import React from "react"
import { AlertCircle, Check, ExternalLink, Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { capture } from "@renderer/lib/analytics"
import { workspaceWebBaseUrl } from "@renderer/lib/workspace-urls"

import { FieldLabel, SectionLabel } from "../onboarding-chrome"
import type { OnboardingPairingApi } from "../use-onboarding-pairing"

/** The workspace-side trail that produces a code, shown as an ordered list. */
const WHERE_IDS = ["open", "nodes", "copy"] as const

export function PairNodeStep({
  pairing,
}: {
  pairing: OnboardingPairingApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    code,
    setCode,
    deviceName,
    setDeviceName,
    status,
    connecting,
    connected,
    error,
    canConnect,
    connect,
  } = pairing

  if (connected) return <PairedPanel pairing={pairing} />

  return (
    <>
      <SectionLabel>{t("onboarding.flow.sections.pairing")}</SectionLabel>

      <FieldLabel
        htmlFor="onboarding-pairing-code"
        label={t("onboarding.flow.pairNode.codeLabel")}
        token="XXXX-XXXX"
        required
      />
      <Input
        id="onboarding-pairing-code"
        value={code}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        disabled={connecting}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canConnect) void connect()
        }}
        placeholder={t("onboarding.flow.pairNode.codePlaceholder")}
        className="h-14 text-center font-mono text-2xl tracking-widest uppercase"
      />
      {error ? (
        <p className="mt-2.5 mb-0 flex items-center gap-2 text-2xs text-(--danger-text)">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        <p className="mt-2.5 mb-0 text-2xs text-(--text-tertiary)">
          {t("onboarding.flow.pairNode.codeHint")}
        </p>
      )}

      <SectionLabel className="mt-9">
        {t("onboarding.flow.sections.device")}
      </SectionLabel>
      <FieldLabel
        htmlFor="onboarding-device-name"
        label={t("onboarding.flow.pairNode.deviceLabel")}
        token={(status?.deviceType || "device").toUpperCase()}
      />
      <Input
        id="onboarding-device-name"
        value={deviceName}
        disabled={connecting}
        onChange={(e) => setDeviceName(e.target.value)}
        placeholder={
          status?.hostname || t("onboarding.flow.pairNode.devicePlaceholder")
        }
      />
      <p className="mt-2.5 mb-0 text-2xs text-(--text-tertiary)">
        {t("onboarding.flow.pairNode.deviceHint")}
      </p>

      {/* Already paired? Then this code adds a workspace rather than moving the
          device between them — memberships are per (workspace, device) and all
          of them stay live. It stopped being a warning when that changed, so it
          is drawn as a note, not a caution. */}
      {status?.connected && (
        <div className="mt-7 flex items-start gap-2.5 rounded-lg border border-(--border) bg-(--bg-card) px-4 py-3">
          <Info className="mt-0.5 size-3.5 shrink-0 text-(--text-tertiary)" />
          <div className="min-w-0">
            <div className="text-xs font-medium">
              {(status.workspaces?.length ?? 0) > 1
                ? t("onboarding.flow.pairNode.alreadyPairedTitleMany", {
                    count: status.workspaces.length,
                  })
                : t("onboarding.flow.pairNode.alreadyPairedTitle", {
                    name: status.workspaceName || status.workspaceSlug || "",
                  })}
            </div>
            <p className="m-0 mt-1 text-2xs text-(--text-secondary)">
              {t("onboarding.flow.pairNode.alreadyPairedBody")}
            </p>
          </div>
        </div>
      )}

      <div className="mt-7 rounded-lg border border-(--border) bg-(--bg-card) p-5">
        <div className="text-sm font-semibold">
          {t("onboarding.flow.pairNode.whereTitle")}
        </div>
        <ol className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {WHERE_IDS.map((id, i) => (
            <li key={id} className="flex items-center gap-2.5 text-xs">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--accent-bg) font-mono text-2xs font-bold text-(--accent)">
                {i + 1}
              </span>
              <span className="text-(--text-secondary)">
                {t(`onboarding.flow.pairNode.where.${id}`)}
              </span>
            </li>
          ))}
        </ol>
        {/* Step 1 presumes a workspace is already open somewhere; a first-time
            user may have none. Give them the front door — sign in on the web,
            where a workspace is provisioned, then come back for the code. */}
        <p className="m-0 mt-3 text-xs text-(--text-secondary)">
          {t("onboarding.flow.pairNode.noWorkspaceYet")}{" "}
          <button
            type="button"
            onClick={() =>
              window.api.openExternal("https://workspace.openagents.org")
            }
            className="cursor-pointer border-0 bg-transparent p-0 text-xs text-(--accent) underline underline-offset-2"
          >
            workspace.openagents.org
          </button>
        </p>
      </div>
    </>
  )
}

/**
 * After a successful redeem. The device is registered and the daemon is up, so
 * everything else — installing agents, starting them — happens in the
 * workspace; there is nothing left to do here but leave.
 */
function PairedPanel({
  pairing,
}: {
  pairing: OnboardingPairingApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const node = pairing.connected!
  // The user came here from the workspace's "Connect agent" page, code in hand.
  // Everything after pairing (installing and starting agents on this device)
  // happens over there, so hand them straight back to the browser. We can't
  // refocus the exact tab they left, but opening the workspace URL brings the
  // browser forward and lands on the page where the flow continues.
  const workspaceRef = node.workspaceSlug || node.workspaceId
  const browserUrl = workspaceRef
    ? `${workspaceWebBaseUrl(node.endpoint ?? undefined)}/${workspaceRef}`
    : null
  const rows: Array<{ id: string; value: string }> = [
    {
      id: "workspace",
      value: node.workspaceName || node.workspaceSlug || "—",
    },
    { id: "device", value: pairing.deviceName.trim() || node.hostname },
    { id: "nodeId", value: node.nodeId || "—" },
  ]

  return (
    <>
      <SectionLabel>{t("onboarding.flow.sections.pairing")}</SectionLabel>

      <div className="rounded-lg border border-(--success-border) bg-(--success-bg) p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--success) text-white">
            <Check className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-base font-semibold">
              {t("onboarding.flow.pairNode.connectedTitle")}
            </div>
            <p className="m-0 mt-1 text-xs leading-relaxed text-(--text-secondary)">
              {t("onboarding.flow.pairNode.connectedDesc")}
            </p>
          </div>
        </div>
        {browserUrl && (
          <Button
            className="mt-4"
            onClick={() => {
              capture("onboarding_continue_in_browser", {
                workspace_id: node.workspaceSlug,
              })
              void window.api.openExternal(browserUrl)
            }}
          >
            <ExternalLink className="size-3.5" />
            {t("onboarding.flow.pairNode.continueInBrowser")}
          </Button>
        )}
      </div>

      <ul className="m-0 mt-3 list-none overflow-hidden rounded-lg border border-(--border) bg-(--bg-card) p-0">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 border-b border-(--border) px-4 py-2.5 last:border-b-0"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-(--success)" />
            <span className="text-sm">
              {t(`onboarding.flow.pairNode.summary.${row.id}`)}
            </span>
            <span className="ml-auto truncate font-mono text-2xs text-(--text-secondary)">
              {row.value}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 mb-0 text-xs text-(--text-tertiary)">
        {t("onboarding.flow.pairNode.connectedFootnote")}
      </p>
    </>
  )
}
