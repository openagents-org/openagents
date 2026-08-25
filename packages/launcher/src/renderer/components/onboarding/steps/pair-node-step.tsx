import React from "react"
import { AlertCircle, ExternalLink, Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import {
  workspaceDisplayHost,
  workspaceWebBaseUrl,
} from "@renderer/lib/workspace-urls"

import { FieldLabel, SectionLabel } from "../onboarding-chrome"
import type { OnboardingPairingApi } from "../use-onboarding-pairing"
import { PairedPanel } from "./paired-panel"

/** What the user does on the web before a pairing code exists, in order. */
const START_IDS = ["signIn", "createWorkspace", "copyCode"] as const

export function PairNodeStep({
  pairing,
  onContinueLocal,
  onFinish,
}: {
  pairing: OnboardingPairingApi
  /** Take the local route: pick, configure and create an agent right here. */
  onContinueLocal: () => void
  /** Take the workspace route: the rest happens in the browser, so we're done. */
  onFinish: () => void
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

  if (connected)
    return (
      <PairedPanel
        pairing={pairing}
        onContinueLocal={onContinueLocal}
        onFinish={onFinish}
      />
    )

  return (
    <>
      {/* Everyone who reaches this step is here for the first time: no
          workspace, often no account. So the web trail that produces a code
          comes first — above the field it fills in, not tucked underneath it,
          where someone with nothing to paste would never scroll to find it. */}
      <SectionLabel>
        {t("onboarding.flow.sections.beforeYouStart")}
      </SectionLabel>
      <StartGuide />

      <SectionLabel className="mt-9">
        {t("onboarding.flow.sections.pairing")}
      </SectionLabel>

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
    </>
  )
}

/**
 * Sign in on the web → create a workspace → copy the code. The launcher cannot
 * do any of the three, so the only thing this panel owes the user is the front
 * door, drawn large enough to be the obvious first move.
 */
function StartGuide(): React.JSX.Element {
  const { t } = useTranslation()
  const host = workspaceDisplayHost()

  return (
    <div className="rounded-lg border border-(--border) bg-(--bg-card) p-5">
      <div className="text-sm font-semibold">
        {t("onboarding.flow.pairNode.start.title")}
      </div>
      <p className="m-0 mt-1 text-xs text-(--text-secondary)">
        {t("onboarding.flow.pairNode.start.desc")}
      </p>
      <ol className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0">
        {START_IDS.map((id, i) => (
          <li key={id} className="flex items-center gap-2.5 text-sm">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--accent-bg) font-mono text-2xs font-bold text-(--accent)">
              {i + 1}
            </span>
            <span className="text-(--text-secondary)">
              {t(`onboarding.flow.pairNode.start.steps.${id}`, { host })}
            </span>
          </li>
        ))}
      </ol>
      <Button
        variant="outline"
        size="lg"
        className="mt-4 w-full"
        onClick={() => void window.api.openExternal(workspaceWebBaseUrl())}
      >
        <ExternalLink className="size-4" />
        {t("onboarding.flow.pairNode.start.open", { host })}
      </Button>
    </div>
  )
}
