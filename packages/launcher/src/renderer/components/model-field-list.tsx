import React from "react"
import { useTranslation } from "react-i18next"
import { Check, CircleAlert, KeyRound, PencilLine, RefreshCw, Terminal } from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@renderer/components/ui/command"
import { InputGroupButton } from "@renderer/components/ui/input-group"
import { Spinner } from "@renderer/components/ui/spinner"
import { cn } from "@renderer/lib/utils"
import type { ModelListPath, ModelListResult } from "@renderer/types"

/**
 * What the model picker's popover shows: the searchable list when there is
 * one, otherwise one quiet line saying what would produce it, and a footer
 * with the Refresh action. The fetching and prefill logic stays in ModelField.
 */
export function ModelFieldList({
  agentType,
  path,
  value,
  loading,
  result,
  onPick,
  onRefresh,
}: {
  agentType: string
  path?: ModelListPath
  value: string
  loading: boolean
  result: ModelListResult | null
  onPick: (id: string) => void
  onRefresh: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  // A CLI's list is usually its signed-in account's. OpenCode's is not — it
  // also carries OpenCode Zen's free models, signed in or not — so an agent can
  // say what its own list is. On the key path a CLI answers for the key typed
  // into the form (Cursor, CodeArts), which is not "your signed-in account".
  const genericSource =
    result && path === "key" && result.source === "cli" ? "cliKey" : result?.source
  const sourceLabel = result
    ? t(`agents.envFields.model.sourceByAgent.${agentType}.${result.source}`, {
        defaultValue: t(`agents.envFields.model.source.${genericSource}`),
      })
    : ""
  // A known reason gets the user's language and names the one thing that would
  // fix it; anything else falls back to what the provider actually said.
  const emptyMessage = loading
    ? t("agents.envFields.model.loading")
    : result?.code
      ? t(`agents.envFields.model.${result.code}`, {
          detail: result.error || "",
        })
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
    <>
      {/* A search box over nothing, and a full-width sentence set in the
          list's own type, is what an empty picker used to look like. When
          there is no list there is nothing to search — so the popover
          becomes one quiet line saying what would produce one. */}
      {result?.models.length ? (
        <Command>
          <CommandInput placeholder={t("agents.envFields.model.search")} />
          <CommandList>
            <CommandEmpty>{t("agents.envFields.model.noMatch")}</CommandEmpty>
            <CommandGroup heading={sourceLabel}>
              {result.models.map((m) => {
                const detail = [
                  m.label,
                  m.note,
                  m.id === result.recommended
                    ? t("agents.envFields.model.recommended")
                    : "",
                ].filter(Boolean)
                return (
                  <CommandItem
                    key={m.id}
                    value={`${m.id} ${m.label || ""}`}
                    onSelect={() => onPick(m.id)}
                  >
                    <Check
                      className={cn(
                        "size-3.5",
                        m.id === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-xs">{m.id}</span>
                      {detail.length > 0 && (
                        <span className="truncate text-xs text-muted-foreground">
                          {detail.join(" — ")}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      ) : (
        <div className="flex max-h-48 items-start gap-2 overflow-y-auto px-3 py-3 text-xs leading-relaxed text-muted-foreground">
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
        <span className="truncate text-xs text-muted-foreground">
          {loading
            ? t("agents.envFields.model.loading")
            : t("agents.envFields.model.freeform")}
        </span>
        <InputGroupButton size="xs" disabled={loading} onClick={onRefresh}>
          <RefreshCw />
          {t("agents.envFields.model.refresh")}
        </InputGroupButton>
      </div>
    </>
  )
}
