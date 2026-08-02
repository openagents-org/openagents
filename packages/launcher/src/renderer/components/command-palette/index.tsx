import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@renderer/components/shadcn/command"
import { Kbd } from "@renderer/components/shadcn/kbd"
import { useCommands, type Command } from "./use-commands"
import { groupCommands } from "./group-commands"
import { pushHistory } from "./history"

function PaletteFooter(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-3xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd>
          {t("commandPalette.footer.navigate")}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⏎</Kbd>
          {t("commandPalette.footer.run")}
        </span>
      </div>
      <span className="flex items-center gap-1">
        <Kbd>⌘K</Kbd>
        {t("commandPalette.footer.toggle")}
      </span>
    </div>
  )
}

export function CommandPalette(): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const commands = useCommands()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    // Escape and focus trapping come from the underlying Dialog.
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  // While searching, ranking belongs to the query — so history is only applied
  // to the resting state.
  const groups = useMemo(
    () =>
      groupCommands(
        commands,
        query.trim() ? null : t("commandPalette.groups.recent"),
      ),
    [commands, query, t],
  )

  const execute = async (cmd: Command): Promise<void> => {
    pushHistory(cmd.id)
    setOpen(false)
    try {
      await cmd.run()
    } catch (err) {
      console.error("Command failed:", err)
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("commandPalette.title")}
      description={t("commandPalette.description")}
      showCloseButton={false}
      className="sm:max-w-2xl"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t("commandPalette.placeholder")}
      />
      <CommandList className="max-h-96">
        <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.name} heading={group.name}>
            {group.items.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={cmd.title}
                keywords={[cmd.group]}
                onSelect={() => void execute(cmd)}
              >
                <cmd.icon />
                <span className="flex-1 truncate">{cmd.title}</span>
                {cmd.subtitle && (
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {cmd.subtitle}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <PaletteFooter />
    </CommandDialog>
  )
}
