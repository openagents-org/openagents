import { useCallback, useEffect, useRef, useState } from "react"

import type { ToastType } from "@renderer/hooks/useToast"
import { capture } from "@renderer/lib/analytics"

import {
  ONBOARDING_KEY,
  ONBOARDING_STEPS,
  OPTIONAL_STEPS_FROM,
  STEP_KEY,
  STEP_NAMES,
  visibleSteps,
  type StepId,
} from "./onboarding-shared"
import { useOnboardingAgents, type OnboardingAgentsApi } from "./use-onboarding-agents"
import { useOnboardingAuth, type OnboardingAuthApi } from "./use-onboarding-auth"
import {
  useOnboardingPairing,
  type OnboardingPairingApi,
} from "./use-onboarding-pairing"
import {
  useOnboardingProvision,
  type OnboardingProvisionApi,
} from "./use-onboarding-provision"

export interface OnboardingFlowApi {
  /**
   * The steps to *show*, in rail order — not necessarily every step there is.
   * The optional local-agent continuation stays out of the tracker until the
   * user actually enters it (see `OPTIONAL_STEPS_FROM`).
   */
  steps: readonly StepId[]
  stepIndex: number
  stepId: StepId
  goNext: () => void
  goBack: () => void
  /** Leaves onboarding; `markComplete` stops it from reopening next launch. */
  close: (markComplete?: boolean) => void
  agents: OnboardingAgentsApi
  auth: OnboardingAuthApi
  provision: OnboardingProvisionApi
  pairing: OnboardingPairingApi
}

/** Composes the wizard's step machine with the feature hooks. */
export function useOnboardingFlow({
  open,
  onClose,
  showToast,
}: {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}): OnboardingFlowApi {
  const [stepIndex, setStepIndex] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(STEP_KEY) || 0)
      return Number.isInteger(n) && n >= 0 ? n : 0
    } catch {
      return 0
    }
  })
  // A resumed session can carry an index from the longer path; clamp rather
  // than render an undefined step. Clamped against every step, not the visible
  // ones — the visible list is derived from where the user is, so deriving the
  // position from it in turn would be circular.
  const index = Math.min(stepIndex, ONBOARDING_STEPS.length - 1)
  const stepId = ONBOARDING_STEPS[index]
  const steps = visibleSteps(index)

  useEffect(() => {
    try {
      localStorage.setItem(STEP_KEY, String(index))
    } catch {}
    // Emit one event per onboarding step so we can see where users drop off.
    capture("onboarding_step_viewed", {
      step: index,
      step_name: STEP_NAMES[stepId],
    })
  }, [index, stepId])

  // Mark the start of onboarding exactly once when the flow first opens.
  const startedRef = useRef(false)
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true
      capture("onboarding_started")
    }
  }, [open])

  const goNext = useCallback(
    () => setStepIndex((s) => Math.min(s + 1, ONBOARDING_STEPS.length - 1)),
    [],
  )
  const goBack = useCallback(() => setStepIndex((s) => Math.max(s - 1, 0)), [])
  const goToStep = useCallback((id: StepId) => {
    const at = ONBOARDING_STEPS.indexOf(id)
    if (at >= 0) setStepIndex(at)
  }, [])
  const goToPicker = useCallback(() => goToStep("agent"), [goToStep])

  const close = useCallback(
    (markComplete = false) => {
      if (markComplete) {
        capture("onboarding_completed")
        try {
          localStorage.setItem(ONBOARDING_KEY, "true")
          localStorage.removeItem(STEP_KEY)
        } catch {}
      }
      onClose()
    },
    [onClose],
  )
  const finish = useCallback(() => close(true), [close])

  const agents = useOnboardingAgents({ open, showToast, onInstalled: goNext })
  const auth = useOnboardingAuth({
    active: open && stepId === "configure",
    entry: agents.selectedEntry,
    showToast,
    onSaved: goNext,
  })
  const provision = useOnboardingProvision({
    open,
    stepId,
    entry: agents.selectedEntry,
    showToast,
    onFinished: finish,
  })
  const pairing = useOnboardingPairing({
    active: open && stepId === "pairNode",
    showToast,
  })

  // If a resumed session points at an agent that's no longer runnable (e.g. it
  // was uninstalled, or its persisted name no longer matches the catalog),
  // don't strand the post-picker steps on a perpetual spinner — once the agent
  // list has actually loaded and the saved selection isn't in it, send the user
  // back to the picker to choose again.
  useEffect(() => {
    if (!open || index < OPTIONAL_STEPS_FROM) return
    if (agents.agentsLoading || agents.agents.length === 0) return
    if (!agents.selectedEntry) goToPicker()
  }, [
    open,
    index,
    agents.agentsLoading,
    agents.agents.length,
    agents.selectedEntry,
    goToPicker,
  ])

  return {
    steps,
    stepIndex: index,
    stepId,
    goNext,
    goBack,
    close,
    agents,
    auth,
    provision,
    pairing,
  }
}
