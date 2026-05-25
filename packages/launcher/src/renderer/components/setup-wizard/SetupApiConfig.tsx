import React, { useState } from "react"
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react"
import { Input } from "../ui/Input"
import { PasswordInput } from "../ui/PasswordInput"
import { Button } from "../ui/Button"
import { translateTestError } from "../../lib/test-error"
import type { EnvField } from "../../types"

interface SetupApiConfigProps {
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  testing: boolean
  errorMessage?: string | null
  onSubmit: () => void
  onSkip: () => void
}

/**
 * Step 1 of the post-install wizard — collect API keys / endpoint / token
 * declared by the agent's env_config. Password fields use PasswordInput so
 * secrets never appear plain in the DOM (per stage.md §2.2 security note).
 */
export function SetupApiConfig({
  fields,
  values,
  onChange,
  testing,
  errorMessage,
  onSubmit,
  onSkip,
}: SetupApiConfigProps): React.JSX.Element {
  if (fields.length === 0) {
    return (
      <>
        <p className="hint mt-2 mb-4">
          This agent has no API key requirements. You can continue and create
          your first instance.
        </p>
        <div className="form-actions">
          <Button variant="primary" onClick={onSubmit}>Continue</Button>
          <Button onClick={onSkip}>Skip</Button>
        </div>
      </>
    )
  }

  return (
    <>
      <p className="hint mt-1 mb-3">
        Saved locally to <code>~/.openagents/env/</code>. Secrets are never
        printed to logs.
      </p>
      {fields.map((f) => {
        const FieldInput = f.password ? PasswordInput : Input
        return (
          <div className="form-group" key={f.name}>
            <label>
              {f.description || f.name}
              {f.required && <span className="required"> *</span>}
            </label>
            <FieldInput
              value={values[f.name] ?? f.default ?? ""}
              onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
              placeholder={f.placeholder || `Enter ${f.name}…`}
            />
          </div>
        )
      })}
      {errorMessage && <TestErrorCard message={errorMessage} />}
      <div className="form-actions">
        <Button variant="primary" onClick={onSubmit} disabled={testing}>
          {testing ? "Testing…" : "Save & test connection"}
        </Button>
        <Button onClick={onSkip}>Skip</Button>
      </div>
    </>
  )
}

function TestErrorCard({ message }: { message: string }): React.JSX.Element {
  const { title, hint, raw } = translateTestError(message)
  const [showDetails, setShowDetails] = useState(false)
  // Only offer the "Show details" toggle when the raw error contains
  // information beyond what's already in the title — no point expanding to
  // see the same text twice.
  const hasExtraDetails =
    !!raw && raw.trim() !== title.trim() && raw.trim() !== hint?.trim()

  return (
    <div
      role="alert"
      className="mt-1 mb-3 rounded-(--radius-sm) border border-(--danger)/30 bg-(--danger-bg) px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className="w-4 h-4 mt-0.5 shrink-0 text-(--danger-text)"
          strokeWidth={2}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-(--danger-text)">
            {title}
          </div>
          {hint && (
            <div className="text-[12px] mt-1 text-(--text-secondary) leading-snug">
              {hint}
            </div>
          )}
          {hasExtraDetails && (
            <>
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] text-(--text-tertiary) hover:text-(--text-secondary) transition-colors cursor-pointer bg-transparent border-0 p-0"
              >
                {showDetails ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                {showDetails ? "Hide details" : "Show details"}
              </button>
              {showDetails && (
                <pre className="mt-1.5 text-[11px] font-mono text-(--text-tertiary) whitespace-pre-wrap break-all max-h-32 overflow-auto bg-(--bg-input)/50 rounded-[4px] px-2 py-1.5 m-0">
                  {raw}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
