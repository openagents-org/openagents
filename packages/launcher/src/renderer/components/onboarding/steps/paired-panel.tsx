import React, { useState } from "react"
import { Check, ChevronRight, ExternalLink, Globe, Laptop } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { capture } from "@renderer/lib/analytics"
import { cn } from "@renderer/lib/utils"
import { workspaceWebBaseUrl } from "@renderer/lib/workspace-urls"

import { SectionLabel } from "../onboarding-chrome"
import type { OnboardingPairingApi } from "../use-onboarding-pairing"

/**
 * After a successful redeem. The device is in; what is left is a real fork —
 * finish the setup here in the launcher, or hand it to the workspace in the
 * browser — so the panel asks for that choice and nothing else. Both routes
 * end with an agent in the paired workspace; only the place you do the work
 * differs. The identifiers this used to list (workspace, device, node id) told
 * the user nothing they had to act on, so they are gone.
 */
export function PairedPanel({
  pairing,
  onContinueLocal,
  onFinish,
}: {
  pairing: OnboardingPairingApi
  onContinueLocal: () => void
  onFinish: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const node = pairing.connected!
  // We can't refocus the exact tab the user left, but opening the workspace URL
  // brings the browser forward and lands on the page where the flow continues.
  const workspaceRef = node.workspaceSlug || node.workspaceId
  const base = workspaceWebBaseUrl(node.endpoint ?? undefined)
  const browserUrl = workspaceRef ? `${base}/${workspaceRef}` : base
  // Handing the setup to the browser does not end the wizard by itself: the
  // browser takes a moment to come forward, and closing behind it drops the
  // user into the main window with no idea what happened or whether it worked.
  // We say what we did, leave both cards live, and let them close this.
  const [handedOff, setHandedOff] = useState(false)

  const openWorkspace = (): void => {
    capture("onboarding_continue_in_browser", {
      workspace_id: node.workspaceSlug,
    })
    void window.api.openExternal(browserUrl)
    setHandedOff(true)
  }

  return (
    <>
      <SectionLabel>{t("onboarding.flow.sections.pairing")}</SectionLabel>

      <div className="flex items-center gap-2.5 rounded-lg border border-(--success-border) bg-(--success-bg) px-4 py-3.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--success) text-white">
          <Check className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {t("onboarding.flow.pairNode.connectedTitle")}
          </div>
          <p className="m-0 mt-0.5 text-xs leading-relaxed text-(--text-secondary)">
            {t("onboarding.flow.pairNode.connectedDesc")}
          </p>
        </div>
      </div>

      <SectionLabel className="mt-9">
        {t("onboarding.flow.sections.nextStep")}
      </SectionLabel>
      <p className="m-0 mb-4 text-sm text-(--text-secondary)">
        {t("onboarding.flow.pairNode.next.prompt")}
      </p>

      {/* Two cards, equal weight: neither route is the fallback of the other,
          and the launcher has no way of knowing which one this user wants. */}
      <div className="grid gap-3 md:grid-cols-2">
        <ChoiceCard
          icon={<Laptop className="size-4" />}
          id="local"
          cta={<ChevronRight className="size-4" />}
          onClick={() => {
            capture("onboarding_continue_in_launcher", {
              workspace_id: node.workspaceSlug,
            })
            onContinueLocal()
          }}
        />
        <ChoiceCard
          icon={<Globe className="size-4" />}
          id="workspace"
          cta={<ExternalLink className="size-4" />}
          onClick={openWorkspace}
        />
      </div>

      {/* Appears only once they have actually taken the remote route — before
          that there is nothing to finish, and a third button next to a two-way
          choice would just be a third option. Pressing the card again reopens
          the browser, so "it didn't open" needs no button of its own. */}
      {handedOff && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-(--accent-border) bg-(--accent-bg) px-4 py-3.5">
          <div className="min-w-50 flex-1">
            <div className="text-sm font-semibold">
              {t("onboarding.flow.pairNode.next.handoff.title")}
            </div>
            <p className="m-0 mt-0.5 text-xs leading-relaxed text-(--text-secondary)">
              {t("onboarding.flow.pairNode.next.handoff.desc")}
            </p>
          </div>
          <Button onClick={onFinish}>
            <Check className="size-4" />
            {t("onboarding.flow.pairNode.next.handoff.finish")}
          </Button>
        </div>
      )}
    </>
  )
}

function ChoiceCard({
  id,
  icon,
  cta,
  onClick,
}: {
  /** Keys the card's copy under `onboarding.flow.pairNode.next.<id>`. */
  id: "local" | "workspace"
  icon: React.ReactNode
  cta: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-(--border) bg-(--bg-card) p-5 text-left transition-colors",
        "hover:border-(--accent) hover:bg-(--accent-bg)",
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-(--accent-bg) text-(--accent)">
        {icon}
      </span>
      <span className="text-sm font-semibold">
        {t(`onboarding.flow.pairNode.next.${id}.title`)}
      </span>
      <span className="text-xs leading-relaxed text-(--text-secondary)">
        {t(`onboarding.flow.pairNode.next.${id}.desc`)}
      </span>
      <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-(--accent)">
        {t(`onboarding.flow.pairNode.next.${id}.cta`)}
        {cta}
      </span>
    </button>
  )
}
