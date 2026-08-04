import { useCallback, useEffect, useRef, useState } from "react"

import type { ToastType } from "@renderer/hooks/useToast"
import { capture } from "@renderer/lib/analytics"

import {
  ONBOARDING_KEY,
  STEP_KEY,
  STEP_NAMES,
  type Step,
} from "./onboarding-shared"
import { useOnboardingAgents, type OnboardingAgentsApi } from "./use-onboarding-agents"
import { useOnboardingAuth, type OnboardingAuthApi } from "./use-onboarding-auth"
import {
  useOnboardingProvision,
  type OnboardingProvisionApi,
} from "./use-onboarding-provision"

export interface OnboardingFlowApi {
  step: Step
  goNext: () => void
  goBack: () => void
  /** Leaves onboarding; `markComplete` stops it from reopening next launch. */
  close: (markComplete?: boolean) => void
  agents: OnboardingAgentsApi
  auth: OnboardingAuthApi
  provision: OnboardingProvisionApi
}

/** Composes the wizard's step machine with the three feature hooks. */
export function useOnboardingFlow({
  open,
  onClose,
  showToast,
}: {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}): OnboardingFlowApi {
  const [step, setStep] = useState<Step>(() => {
    try {
      const raw = localStorage.getItem(STEP_KEY)
      const n = raw ? Number(raw) : 0
      return ([0, 1, 2, 3, 4].includes(n) ? n : 0) as Step
    } catch {
      return 0
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STEP_KEY, String(step))
    } catch {}
    // Emit one event per onboarding step so we can see where users drop off.
    capture("onboarding_step_viewed", { step, step_name: STEP_NAMES[step] })
  }, [step])

  // Mark the start of onboarding exactly once when the flow first opens.
  const startedRef = useRef(false)
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true
      capture("onboarding_started")
    }
  }, [open])

  const goNext = useCallback(
    () => setStep((s) => Math.min(s + 1, 4) as Step),
    [],
  )
  const goBack = useCallback(() => setStep((s) => Math.max(s - 1, 0) as Step), [])
  const goToPicker = useCallback(() => setStep(1), [])
  const goToCreateAgent = useCallback(() => setStep(3), [])

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
    active: open && step === 2,
    entry: agents.selectedEntry,
    showToast,
    onSaved: goNext,
  })
  const provision = useOnboardingProvision({
    open,
    step,
    entry: agents.selectedEntry,
    showToast,
    onAgentCreated: goNext,
    onFinished: finish,
    onNeedsAgent: goToCreateAgent,
  })

  // If a resumed session points at an agent that's no longer runnable (e.g. it
  // was uninstalled, or its persisted name no longer matches the catalog),
  // don't strand the post-picker steps on a perpetual spinner — once the agent
  // list has actually loaded and the saved selection isn't in it, send the user
  // back to the picker to choose again.
  useEffect(() => {
    if (!open || step < 2) return
    if (agents.agentsLoading || agents.agents.length === 0) return
    if (!agents.selectedEntry) goToPicker()
  }, [
    open,
    step,
    agents.agentsLoading,
    agents.agents.length,
    agents.selectedEntry,
    goToPicker,
  ])

  return { step, goNext, goBack, close, agents, auth, provision }
}
