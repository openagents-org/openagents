import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../shadcn/dialog"
import AgentIcon from "../AgentIcon"
import { cn } from "../../lib/utils"
import { useUiStore } from "../../store/ui"
import type { CatalogEntry, EnvField } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { SetupApiConfig } from "./SetupApiConfig"
import { SetupConnectionTest } from "./SetupConnectionTest"
import { SetupCreateInstance } from "./SetupCreateInstance"

type Step = "configure" | "test" | "create"

interface SetupWizardProps {
  entry: CatalogEntry | null
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Post-install setup wizard (stage.md §2.4). Composes the three step
 * components and owns the IPC plumbing — fetching env_config, saving env,
 * running testLLM, and finally addAgent. Skipping at any step is allowed so
 * the user is never trapped.
 */
export default function SetupWizard({
  entry,
  open,
  onClose,
  showToast,
}: SetupWizardProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("configure")
  const [envFields, setEnvFields] = useState<EnvField[]>([])
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [agentName, setAgentName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)

  useEffect(() => {
    if (!open || !entry) return
    setStep("configure")
    setTestResult(null)
    setAgentName(`my-${entry.name}`)
    ;(async () => {
      try {
        const [fields, saved] = await Promise.all([
          window.api.getEnvFields(entry.name).catch(() => [] as EnvField[]),
          window.api.getAgentEnv(entry.name).catch(() => ({}) as Record<string, string>),
        ])
        setEnvFields(fields || [])
        setEnvValues({ ...(saved || {}) })
        if (!fields || fields.length === 0) setStep("create")
      } catch {
        setEnvFields([])
      }
    })()
  }, [open, entry])

  if (!entry) return null

  async function saveAndTest(): Promise<void> {
    if (!entry) return
    setTesting(true)
    setTestResult(null)
    try {
      await window.api.saveAgentEnv(entry.name, envValues)
      try {
        const r = await window.api.testLLM(envValues)
        if (r.success) {
          setTestResult({
            ok: true,
            message: t("onboarding.wizard.test.okResponded", {
              model: r.model || t("onboarding.wizard.test.model"),
            }),
          })
          setStep("test")
        } else {
          setTestResult({
            ok: false,
            message: r.error || t("onboarding.wizard.test.testFailed"),
          })
        }
      } catch (e: unknown) {
        setTestResult({ ok: false, message: (e as Error).message })
      }
    } finally {
      setTesting(false)
    }
  }

  async function createAgent(): Promise<void> {
    if (!entry) return
    const name = agentName.trim() || `my-${entry.name}`
    setSubmitting(true)
    try {
      await window.api.addAgent({ name, type: entry.name })
      showToast(t("onboarding.wizard.toast.agentCreated", { name }), "success")
      onClose()
      setCurrentTab("agents")
    } catch (e: unknown) {
      showToast(
        t("onboarding.wizard.toast.createFailed", {
          message: (e as Error).message,
        }),
        "error",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const stepIndex: Record<Step, number> = { configure: 0, test: 1, create: 2 }
  const idx = stepIndex[step]
  const steps: Array<{ key: Step; label: string }> = [
    { key: "configure", label: t("onboarding.wizard.steps.configure") },
    { key: "test", label: t("onboarding.wizard.steps.test") },
    { key: "create", label: t("onboarding.wizard.steps.create") },
  ]

  const openLoginTerminal = (): void => {
    const cmd = entry.check_ready?.login_command
    if (!cmd) return
    window.api
      .openTerminal(cmd)
      .catch((e: Error) =>
        showToast(
          t("onboarding.wizard.toast.openTerminalFailed", {
            message: e.message,
          }),
          "error",
        ),
      )
  }

  const configureProps = {
    fields: envFields,
    values: envValues,
    onChange: setEnvValues,
    testing,
    errorMessage: testResult && !testResult.ok ? testResult.message : null,
    onSubmit: envFields.length === 0 ? () => setStep("create") : saveAndTest,
    onSkip: onClose,
    loginCommand: entry.check_ready?.login_command || null,
    onLogin: openLoginTerminal,
    onContinueWithoutKey: () => setStep("create"),
  }

  const testProps = {
    ok: !!testResult?.ok,
    message:
      testResult?.message || t("onboarding.wizard.test.connectionSuccessful"),
    onNext: () => setStep("create"),
    onBack: () => setStep("configure"),
  }

  const createProps = {
    agentName,
    setAgentName,
    defaultName: `my-${entry.name}`,
    submitting,
    onSubmit: createAgent,
    onCancel: onClose,
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <div className="flex items-center gap-3 mb-2">
          <AgentIcon type={entry.name} size={28} />
          <DialogTitle className="m-0">
            {t("onboarding.wizard.title", { label: entry.label || entry.name })}
          </DialogTitle>
        </div>
        <p className="hint m-0 mb-3">{t("onboarding.wizard.subtitle")}</p>

        <div className="wizard-steps mb-0">
          {steps.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && <div className="wizard-step-sep" />}
              <div className={cn("wizard-step", idx === i && "active", idx > i && "done")}>
                <span className="dot">{idx > i ? "✓" : i + 1}</span>
                <span>{s.label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </DialogHeader>

      <DialogBody>
        {step === "configure" && (
          <SetupApiConfig {...configureProps} section="body" />
        )}
        {step === "test" && (
          <SetupConnectionTest {...testProps} section="body" />
        )}
        {step === "create" && (
          <SetupCreateInstance {...createProps} section="body" />
        )}
      </DialogBody>

      <DialogFooter>
        {step === "configure" && (
          <SetupApiConfig {...configureProps} section="footer" />
        )}
        {step === "test" && (
          <SetupConnectionTest {...testProps} section="footer" />
        )}
        {step === "create" && (
          <SetupCreateInstance {...createProps} section="footer" />
        )}
      </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
