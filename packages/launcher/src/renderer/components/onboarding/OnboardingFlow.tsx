import React from "react"
import ReactDOM from "react-dom"

import type { ToastType } from "@renderer/hooks/useToast"

import { OnboardingFooter } from "./onboarding-footer"
import { OnboardingHeader } from "./onboarding-header"
import { OnboardingRail } from "./onboarding-rail"
import { ONBOARDING_KEY } from "./onboarding-shared"
import {
  useOnboardingFlow,
  type OnboardingFlowApi,
} from "./use-onboarding-flow"
import { AgentSelectionStep } from "./steps/agent-selection-step"
import { ApiKeyStep } from "./steps/api-key-step"
import { ConnectWorkspaceStep } from "./steps/connect-workspace-step"
import { CreateAgentStep } from "./steps/create-agent-step"
import { WelcomeStep } from "./steps/welcome-step"

function StepBody({
  flow,
}: {
  flow: OnboardingFlowApi
}): React.JSX.Element | null {
  const { step, agents, auth, provision } = flow
  switch (step) {
    case 0:
      return (
        <WelcomeStep
          agentCount={agents.agents.length || (agents.agentsLoading ? null : 0)}
        />
      )
    case 1:
      return <AgentSelectionStep agents={agents} />
    case 2:
      return <ApiKeyStep entry={agents.selectedEntry} auth={auth} />
    case 3:
      return (
        <CreateAgentStep
          entry={agents.selectedEntry}
          auth={auth}
          provision={provision}
        />
      )
    case 4:
      return <ConnectWorkspaceStep provision={provision} />
    default:
      return null
  }
}

export function OnboardingFlow({
  open,
  onClose,
  showToast,
}: {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element | null {
  const flow = useOnboardingFlow({ open, onClose, showToast })

  if (!open) return null

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-1500 flex bg-(--bg-primary)">
      <OnboardingRail step={flow.step} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* The heading is pinned in its own row: it lands at the same height on
            every step and never moves when the content below it grows, shrinks
            (filtering) or scrolls. */}
        <div className="shrink-0 px-10 pt-10 pb-6">
          <div className="mx-auto w-full max-w-4xl">
            <OnboardingHeader flow={flow} />
          </div>
        </div>

        {/* pt-1.5 is not spacing, it is clearance: `overflow-y-auto` clips at
            the padding edge, so a control sitting flush against the top of the
            scroll area gets its focus ring sliced off. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-1.5 pb-10">
          <div className="mx-auto w-full max-w-4xl">
            <StepBody flow={flow} />
          </div>
        </div>

        <OnboardingFooter flow={flow} />
      </div>
    </div>,
    document.body,
  )
}

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== "true"
  } catch {
    return false
  }
}
