import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown } from "lucide-react"

import { ModelFieldList } from "@renderer/components/model-field-list"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@renderer/components/ui/input-group"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover"
import { Spinner } from "@renderer/components/ui/spinner"
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
 *
 * `prefill` is for a field that cannot be left empty on a path with nothing to
 * type from (OpenCode's sign-in): the list is fetched straight away and the
 * model it recommends is filled in, so the user starts from a model that runs
 * rather than from a required blank. A value the user typed is never replaced.
 */
export function ModelField({
  id,
  agentType,
  value,
  env,
  path,
  placeholder,
  prefill = false,
  reloadKey,
  onChange,
}: {
  id: string
  agentType: string
  value: string
  env: Record<string, string>
  path?: ModelListPath
  placeholder?: string
  prefill?: boolean
  /** Changes when the list's source changed underneath it (a sign-in). */
  reloadKey?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ModelListResult | null>(null)
  // Bumped whenever a list stops applying, so an answer still in flight for
  // the old credentials is dropped instead of landing on the new ones.
  const request = useRef(0)
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // The id this field filled in by itself, as opposed to one the user chose.
  const autoFilled = useRef<string | null>(null)

  // `refresh` skips main's short-lived cache of CLI lists — it is what the
  // Refresh button is for. Every other load may be answered from it.
  const load = useCallback(
    async (refresh = false): Promise<void> => {
      const mine = ++request.current
      setLoading(true)
      try {
        const next = refresh
          ? await window.api.listModels(agentType, env, path, { refresh: true })
          : await window.api.listModels(agentType, env, path)
        if (mine === request.current) setResult(next)
      } catch (err: unknown) {
        if (mine === request.current)
          setResult({ models: [], source: "none", error: (err as Error).message })
      } finally {
        if (mine === request.current) setLoading(false)
      }
    },
    [agentType, env, path],
  )

  // Fetch on open, and only the first time: reopening the picker to pick a
  // different model shouldn't re-hit the provider. Refresh is explicit. An
  // empty answer is the exception — it is a reason ("sign in first", a timed
  // out CLI), and the user reopening is them having done something about it.
  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next && !loading && !result?.models.length) void load()
  }

  // …but a list belongs to the credentials it was fetched with. Clearing the
  // key and reopening the picker used to re-present the old provider's models
  // as if they still applied — the one thing this field exists to stop. Only
  // the credential inputs count: keying off the whole form would throw the
  // list away on every keystroke in the model box itself.
  const credentials = useMemo(
    () =>
      Object.keys(env)
        .filter((k) => /API_KEY$|BASE_URL$|_TOKEN$|_PROVIDER$|_AK$|_SK$/.test(k))
        .sort()
        .map((k) => `${k}=${env[k] || ""}`)
        .join("\n"),
    [env],
  )
  useEffect(() => {
    request.current++
    setResult(null)
    setLoading(false)
  }, [credentials, path, reloadKey])

  // A field still empty (or holding only our own earlier pick) loads without
  // waiting for the picker. Once any answer is in, this stays quiet until the
  // effect above throws that answer away.
  useEffect(() => {
    if (!prefill || result || loading) return
    const current = valueRef.current.trim()
    if (current && current !== autoFilled.current) return
    void load()
  }, [prefill, result, loading, load])

  useEffect(() => {
    const recommended = result?.recommended
    if (!prefill || !recommended) return
    const current = valueRef.current.trim()
    if (current === recommended) return
    if (current && current !== autoFilled.current) return
    autoFilled.current = recommended
    onChangeRef.current(recommended)
  }, [prefill, result])

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      {/* The whole field is the anchor, not the small chevron that opens it:
          the list lines up under the input and takes its width. */}
      <PopoverAnchor>
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
                eats every wheel event that isn't inside its own subtree — the
                list could only be moved by dragging its scrollbar. */}
            {/* Labelled and filled, not a bare chevron: in user interviews
                people did not find the list behind the small up/down arrow. */}
            <PopoverTrigger asChild>
              <InputGroupButton
                size="xs"
                variant="secondary"
                className="text-xs"
                data-testid="model-field-browse"
              >
                {loading ? <Spinner /> : null}
                {t("agents.envFields.model.browse")}
                {!loading && <ChevronDown />}
              </InputGroupButton>
            </PopoverTrigger>
          </InputGroupAddon>
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 overflow-hidden p-0"
      >
        <ModelFieldList
          agentType={agentType}
          path={path}
          value={value}
          loading={loading}
          result={result}
          onPick={(model) => {
            onChange(model)
            setOpen(false)
          }}
          onRefresh={() => void load(true)}
        />
      </PopoverContent>
    </Popover>
  )
}
