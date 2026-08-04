import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { AgentEnvFields } from "@renderer/components/agent-env-fields"
import { cn } from "@renderer/lib/utils"
import type { EnvField } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

interface Props {
  agentName: string
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Env / API key configuration, edited in place. Saves to `~/.openagents/env/`
 * via saveAgentEnv and never echoes a secret into a toast or a log line. The
 * inline "Test connection" rides on the core's testLLM helper.
 */
export function DetailConfig({
  agentName,
  fields,
  values,
  onChange,
  showToast,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (fields.length === 0) return null

  async function save(): Promise<void> {
    // Inputs display `f.default` as a fallback, but an untouched field is
    // absent from `values` — fold defaults in so a pre-filled value is
    // actually persisted, then check required fields against the result.
    const payload: Record<string, string> = {}
    for (const f of fields) payload[f.name] = (values[f.name] ?? f.default ?? "").trim()

    const missing = fields.find((f) => f.required && !payload[f.name])
    if (missing) {
      showToast(
        t("agents.envConfig.fieldRequired", {
          field: missing.description || missing.name,
        }),
        "warning",
      )
      return
    }

    setSaving(true)
    try {
      await window.api.saveAgentEnv(agentName, payload)
      showToast(t("agents.envConfig.toast.configurationSaved"), "success")
    } catch (e: unknown) {
      showToast(
        t("agents.envConfig.toast.error", { message: (e as Error).message }),
        "error",
      )
    } finally {
      setSaving(false)
    }
  }

  async function testConnection(): Promise<void> {
    setTesting(true)
    setResult(null)
    try {
      const r = await window.api.testLLM(values)
      setResult(
        r.success
          ? {
              ok: true,
              message: t("agents.envConfig.toast.okResponded", {
                model: r.model || t("agents.envConfig.toast.modelFallback"),
              }),
            }
          : { ok: false, message: r.error || t("agents.envConfig.toast.testFailed") },
      )
    } catch (e: unknown) {
      setResult({ ok: false, message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="gap-4 px-5 py-5">
      <AgentEnvFields
        fields={fields}
        values={values}
        onChange={(name, value) => onChange({ ...values, [name]: value })}
        idPrefix="agent-detail-env"
      />

      {result && (
        <p
          className={cn(
            "m-0 text-xs",
            result.ok ? "text-(--success-text)" : "text-(--danger-text)",
          )}
        >
          {result.message}
        </p>
      )}

      <div className="flex gap-2 border-t pt-4">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? t("agents.envConfig.saving") : t("agents.envConfig.save")}
        </Button>
        <Button size="sm" variant="outline" onClick={testConnection} disabled={testing}>
          {testing
            ? t("agents.envConfig.testing")
            : t("agents.envConfig.testConnection")}
        </Button>
      </div>
    </Card>
  )
}
