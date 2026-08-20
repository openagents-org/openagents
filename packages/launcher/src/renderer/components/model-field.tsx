import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Check,
  ChevronsUpDown,
  CircleAlert,
  KeyRound,
  PencilLine,
  RefreshCw,
  Terminal,
} from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@renderer/components/ui/command"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@renderer/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover"
import { Spinner } from "@renderer/components/ui/spinner"
import { cn } from "@renderer/lib/utils"
import type { ModelListPath, ModelListResult } from "@renderer/types"

/**
 * The model input, with the agent's REAL model list behind it.
 *
 * A pinned default in the field spec is how a codex agent ended up calling a
 * model OpenAI had retired, with no input on screen to change it. So the value
 * stays free-form (private deployments, relay channels, empty = the CLI's own
 * default) and the picker offers what the account/endpoint actually serves.
 * The list is fetched on demand — one request when the user opens the picker,
 * not on every render of the form.
 *
 * `env` is the LIVE form values, not what was saved: the point is that typing a
 * relay's base URL and key then opening the picker lists that relay's channels.
 * `path` is which auth form this input sits in, and it decides the source —
 * without it, a key form on a machine with the CLI signed in was answered by
 * the CLI's account, which is a confident wrong answer for that endpoint.
 */
export function ModelField({
  id,
  agentType,
  value,
  env,
  path,
  placeholder,
  onChange,
}: {
  id: string
  agentType: string
  value: string
  env: Record<string, string>
  path?: ModelListPath
  placeholder?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ModelListResult | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setResult(await window.api.listModels(agentType, env, path))
    } catch (err: unknown) {
      setResult({ models: [], source: "none", error: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [agentType, env, path])

  // Fetch on open, and only the first time: reopening the picker to pick a
  // different model shouldn't re-hit the provider. Refresh is explicit.
  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next && !result && !loading) void load()
  }

  // …but a list belongs to the credentials it was fetched with. Clearing the
  // key and reopening the picker used to re-present the old provider's models
  // as if they still applied — the one thing this field exists to stop. Only
  // the credential inputs count: keying off the whole form would throw the
  // list away on every keystroke in the model box itself.
  const credentials = useMemo(
    () =>
      Object.keys(env)
        .filter((k) => /API_KEY$|BASE_URL$|_TOKEN$|_PROVIDER$/.test(k))
        .sort()
        .map((k) => `${k}=${env[k] || ""}`)
        .join("\n"),
    [env],
  )
  useEffect(() => {
    setResult(null)
  }, [credentials, path])

  const hasModels = !!result?.models.length
  const sourceLabel = result
    ? t(`agents.envFields.model.source.${result.source}`)
    : ""
  // A known reason gets the user's language and names the one thing that would
  // fix it; anything else falls back to what the provider actually said.
  const emptyMessage = loading
    ? t("agents.envFields.model.loading")
    : result?.code
      ? t(`agents.envFields.model.${result.code}`)
      : result?.error || t("agents.envFields.model.empty")
  // The icon says which kind of "no list" this is at a glance: something to
  // fill in, somewhere to sign in, or nothing to expect at all.
  const EmptyIcon =
    result?.code === "need_key"
      ? KeyRound
      : result?.code === "need_login"
        ? Terminal
        : result?.code === "no_list"
          ? PencilLine
          : CircleAlert

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || t("agents.envFields.model.placeholder")}
      />
      <InputGroupAddon align="inline-end">
        {/* `modal` is what makes the wheel work over the list. Without it
            the popover portals outside any dialog's scroll lock, which then
            eats every wheel event that isn't inside its own subtree — the list
            could only be moved by dragging its scrollbar. */}
        <Popover open={open} onOpenChange={onOpenChange} modal>
          <PopoverTrigger asChild>
            <InputGroupButton
              size="icon-xs"
              aria-label={t("agents.envFields.model.browse")}
            >
              {loading ? <Spinner /> : <ChevronsUpDown />}
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            {/* A search box over nothing, and a full-width sentence set in the
                list's own type, is what an empty picker used to look like. When
                there is no list there is nothing to search — so the popover
                becomes one quiet line saying what would produce one. */}
            {hasModels ? (
              <Command>
                <CommandInput
                  placeholder={t("agents.envFields.model.search")}
                />
                <CommandList>
                  <CommandEmpty>
                    {t("agents.envFields.model.noMatch")}
                  </CommandEmpty>
                  <CommandGroup heading={sourceLabel}>
                    {result!.models.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={`${m.id} ${m.label || ""}`}
                        onSelect={() => {
                          onChange(m.id)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "size-3.5",
                            m.id === value ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-xs">
                            {m.id}
                          </span>
                          {(m.label || m.note) && (
                            <span
                              className={cn(
                                "truncate text-2xs",
                                m.deprecated
                                  ? "text-(--warning-text)"
                                  : "text-(--text-tertiary)",
                              )}
                            >
                              {[m.label, m.note].filter(Boolean).join(" — ")}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            ) : (
              <div className="flex max-h-48 items-start gap-2 overflow-y-auto px-3 py-3 text-xs leading-relaxed text-(--text-tertiary)">
                {loading ? (
                  <Spinner className="mt-px size-3.5 shrink-0" />
                ) : (
                  <EmptyIcon className="mt-px size-3.5 shrink-0" />
                )}
                {/* A provider's error is one long unbroken token often enough
                    (a JSON envelope, a request id) that it has to be allowed
                    to break mid-word, or it runs straight out of the popover. */}
                <span className="min-w-0 break-words">{emptyMessage}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
              <span className="truncate text-2xs text-(--text-tertiary)">
                {loading
                  ? t("agents.envFields.model.loading")
                  : t("agents.envFields.model.freeform")}
              </span>
              <InputGroupButton
                size="xs"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw />
                {t("agents.envFields.model.refresh")}
              </InputGroupButton>
            </div>
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  )
}
