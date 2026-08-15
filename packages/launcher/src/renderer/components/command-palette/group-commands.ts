import { loadHistory } from "./history"
import type { Command } from "./use-commands"

export interface CommandGroupData {
  name: string
  items: Command[]
}

/**
 * Buckets commands by group, preserving first-seen order.
 *
 * `recentLabel` promotes previously-run commands into a leading "Recent" group
 * and removes them from their original group so nothing appears twice. Pass
 * `null` while a search is active: then the ranking should come from the query,
 * not from history, and every command stays under its real group.
 */
export function groupCommands(
  commands: Command[],
  recentLabel: string | null,
): CommandGroupData[] {
  const groups: CommandGroupData[] = []
  let rest = commands

  if (recentLabel) {
    const byId = new Map(commands.map((c) => [c.id, c]))
    const recent = loadHistory()
      .map((id) => byId.get(id))
      .filter((c): c is Command => !!c)

    if (recent.length > 0) {
      groups.push({ name: recentLabel, items: recent })
      const seen = new Set(recent.map((c) => c.id))
      rest = commands.filter((c) => !seen.has(c.id))
    }
  }

  for (const cmd of rest) {
    const existing = groups.find((g) => g.name === cmd.group)
    if (existing) existing.items.push(cmd)
    else groups.push({ name: cmd.group, items: [cmd] })
  }

  return groups
}
