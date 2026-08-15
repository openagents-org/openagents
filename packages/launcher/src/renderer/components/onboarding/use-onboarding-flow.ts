import { useCallback, useEffect, useRef, useState } from "react"

import type { ToastType } from "@renderer/hooks/useToast"
import { capture } from "@renderer/lib/analytics"

import {
  MODE_KEY,
  MODE_STEPS,
  ONBOARDING_KEY,
  STEP_KEY,
  STEP_NAMES,
  readMode,
  type OnboardingMode,
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
  mode: OnboardingMode
  /** Switching paths restarts the walk from the step after Welcome. */
  setMode: (m: OnboardingMode) => void
  /** The active path's steps, in rail order. */
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
  const [mode, setModeState] = useState<OnboardingMode>(readMode)
  const steps = MODE_STEPS[mode]
  const [stepIndex, setStepIndex] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(STEP_KEY) || 0)
      return Number.isInteger(n) && n >= 0 ? n : 0
    } catch {
      return 0
    }
  })
  // A resumed session can carry an index from the longer path; clamp rather
  // than render an undefined step.
  const index = Math.min(stepIndex, steps.length - 1)
  const stepId = steps[index]

  useEffect(() => {
    try {
      localStorage.setItem(STEP_KEY, String(index))
      localStorage.setItem(MODE_KEY, mode)
    } catch {}
    // Emit one event per onboarding step so we can see where users drop off.
    capture("onboarding_step_viewed", {
      step: index,
      step_name: STEP_NAMES[stepId],
      mode,
    })
  }, [index, stepId, mode])

  // Mark the start of onboarding exactly once when the flow first opens.
  const startedRef = useRef(false)
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true
      capture("onboarding_started")
    }
  }, [open])

  const setMode = useCallback((m: OnboardingMode) => {
    setModeState(m)
    setStepIndex((s) => Math.min(s, MODE_STEPS[m].length - 1))
    capture("onboarding_mode_selected", { mode: m })
  }, [])

  const goNext = useCallback(
    () => setStepIndex((s) => Math.min(s + 1, steps.length - 1)),
    [steps.length],
  )
  const goBack = useCallback(() => setStepIndex((s) => Math.max(s - 1, 0)), [])
  const goToStep = useCallback(
    (id: StepId) => {
      const at = steps.indexOf(id)
      if (at >= 0) setStepIndex(at)
    },
    [steps],
  )
  const goToPicker = useCallback(() => goToStep("agent"), [goToStep])
  const goToCreateAgent = useCallback(() => goToStep("createAgent"), [goToStep])

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
    onAgentCreated: goNext,
    onFinished: finish,
    onNeedsAgent: goToCreateAgent,
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
    if (!open || mode !== "agent" || index < 2) return
    if (agents.agentsLoading || agents.agents.length === 0) return
    if (!agents.selectedEntry) goToPicker()
  }, [
    open,
    mode,
    index,
    agents.agentsLoading,
    agents.agents.length,
    agents.selectedEntry,
    goToPicker,
  ])

  return {
    mode,
    setMode,
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
