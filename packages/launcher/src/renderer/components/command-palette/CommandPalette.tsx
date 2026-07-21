import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactDOM from "react-dom"
import {
  Search,
  LayoutDashboard,
  Settings as SettingsIcon,
  Layers,
  Plug,
  KeyRound,
  Github,
  FileText,
  Download,
  Play,
  Square,
  Plus,
  Folder,
  Moon,
  Sun,
  Monitor,
  Cpu,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { useUiStore } from "../../store/ui"
import { useAgentsStore } from "../../store/agents"
import { useThemeStore, type ThemeMode } from "../../store/theme"
import { cn } from "../../lib/utils"

const HISTORY_KEY = "launcher:command-history"
const MAX_HISTORY = 10

export interface Command {
  id: string
  title: string
  subtitle?: string
  group: string
  keywords?: string
  icon?: React.JSX.Element
  shortcut?: string
  run: () => void | Promise<void>
}

function score(query: string, cmd: Command): number {
  if (!query) return 1
  const q = query.toLowerCase().trim()
  const hay = `${cmd.title} ${cmd.subtitle || ""} ${cmd.group} ${cmd.keywords || ""}`.toLowerCase()
  if (hay.includes(q)) return 2
  // Fuzzy: every char of q appears in hay in order
  let i = 0
  for (const ch of hay) {
    if (ch === q[i]) i += 1
    if (i === q.length) return 1
  }
  return 0
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string").slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

function pushHistory(id: string): void {
  try {
    const prev = loadHistory().filter((s) => s !== id)
    const next = [id, ...prev].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {}
}

export function CommandPalette(): React.JSX.Element | null {
  const { t } = useTranslation()
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const goToInstallList = useUiStore((s) => s.goToInstallList)
  const setInstallFocusAgent = useUiStore((s) => s.setInstallFocusAgent)
  const agents = useAgentsStore((s) => s.agents)
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Stable ids so the input's aria-controls / aria-activedescendant can point
  // at the listbox and the currently highlighted option.
  const baseId = React.useId()
  const listId = `${baseId}-list`
  const optionId = useCallback(
    (index: number): string => `${baseId}-opt-${index}`,
    [baseId],
  )

  // Global hotkey (Cmd/Ctrl+K)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")
      if (isCmdK) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  // Build commands
  const commands: Command[] = useMemo(() => {
    const navTabs: Array<[string, string, React.JSX.Element]> = [
      ["dashboard", t("commandPalette.nav.dashboard"), <LayoutDashboard key="d" className="w-3.5 h-3.5" />],
      ["agents", t("commandPalette.nav.agents"), <Cpu key="a" className="w-3.5 h-3.5" />],
      ["workspaces", t("commandPalette.nav.workspaces"), <Layers key="w" className="w-3.5 h-3.5" />],
      ["connections", t("commandPalette.nav.connections"), <Plug key="cn" className="w-3.5 h-3.5" />],
      ["credentials", t("commandPalette.nav.credentials"), <KeyRound key="k" className="w-3.5 h-3.5" />],
      ["github", t("commandPalette.nav.github"), <Github key="g" className="w-3.5 h-3.5" />],
      ["install", t("commandPalette.nav.install"), <Download key="i" className="w-3.5 h-3.5" />],
      ["logs", t("commandPalette.nav.logs"), <FileText key="l" className="w-3.5 h-3.5" />],
      ["settings", t("commandPalette.nav.settings"), <SettingsIcon key="s" className="w-3.5 h-3.5" />],
    ]

    const navCmds: Command[] = navTabs.map(([id, label, icon]) => ({
      id: `nav:${id}`,
      title: t("commandPalette.commands.goTo", { label }),
      group: t("commandPalette.groups.navigation"),
      icon,
      run: () => {
        if (id === "install") goToInstallList()
        else setCurrentTab(id)
      },
    }))

    const agentCmds: Command[] = []
    for (const a of agents) {
      const isRunning = ["online", "running", "idle"].includes(a.state)
      agentCmds.push({
        id: `agent:open:${a.name}`,
        title: t("commandPalette.commands.openAgent", { name: a.name }),
        subtitle: a.type,
        group: t("commandPalette.groups.agents"),
        icon: <Cpu className="w-3.5 h-3.5" />,
        run: () => {
          setCurrentTab("agents")
          setInstallFocusAgent(a.name)
        },
      })
      if (isRunning) {
        agentCmds.push({
          id: `agent:stop:${a.name}`,
          title: t("commandPalette.commands.stopAgent", { name: a.name }),
          group: t("commandPalette.groups.agents"),
          icon: <Square className="w-3.5 h-3.5" />,
          run: () => void window.api.stopAgent(a.name),
        })
      } else {
        agentCmds.push({
          id: `agent:start:${a.name}`,
          title: t("commandPalette.commands.startAgent", { name: a.name }),
          group: t("commandPalette.groups.agents"),
          icon: <Play className="w-3.5 h-3.5" />,
          run: () => void window.api.startAgent(a.name),
        })
      }
    }

    const actionCmds: Command[] = [
      {
        id: "action:start-all",
        title: t("commandPalette.commands.startAll"),
        group: t("commandPalette.groups.actions"),
        icon: <Play className="w-3.5 h-3.5" />,
        run: () => void window.api.startAll(),
      },
      {
        id: "action:stop-all",
        title: t("commandPalette.commands.stopAll"),
        group: t("commandPalette.groups.actions"),
        icon: <Square className="w-3.5 h-3.5" />,
        run: () => void window.api.stopAll(),
      },
      {
        id: "action:install-agent",
        title: t("commandPalette.commands.installAgent"),
        group: t("commandPalette.groups.actions"),
        icon: <Plus className="w-3.5 h-3.5" />,
        run: () => goToInstallList(),
      },
      {
        id: "action:new-workspace",
        title: t("commandPalette.commands.newWorkspace"),
        group: t("commandPalette.groups.actions"),
        icon: <Folder className="w-3.5 h-3.5" />,
        run: () => setCurrentTab("workspaces"),
      },
    ]

    const themeCmds: Command[] = (["light", "dark", "system"] as ThemeMode[]).map((m) => ({
      id: `theme:${m}`,
      title: t("commandPalette.commands.theme", { mode: t(`commandPalette.themes.${m}`) }),
      group: t("commandPalette.groups.appearance"),
      icon:
        m === "dark" ? (
          <Moon className="w-3.5 h-3.5" />
        ) : m === "light" ? (
          <Sun className="w-3.5 h-3.5" />
        ) : (
          <Monitor className="w-3.5 h-3.5" />
        ),
      subtitle: mode === m ? t("commandPalette.current") : undefined,
      run: () => setMode(m),
    }))

    return [...navCmds, ...agentCmds, ...actionCmds, ...themeCmds]
  }, [agents, setCurrentTab, goToInstallList, setInstallFocusAgent, mode, setMode, t])

  const ranked = useMemo(() => {
    if (!query.trim()) {
      const history = loadHistory()
      const byId = new Map(commands.map((c) => [c.id, c]))
      const recent = history
        .map((id) => byId.get(id))
        .filter((c): c is Command => !!c)
        .map((c) => ({ ...c, group: t("commandPalette.groups.recent") }))
      const seen = new Set(recent.map((c) => c.id))
      return [...recent, ...commands.filter((c) => !seen.has(c.id))]
    }
    return commands
      .map((c) => ({ c, s: score(query, c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
  }, [query, commands, t])

  // Group rendering — collapse to flat array but track group changes for headers
  const grouped = useMemo(() => {
    const out: Array<{ type: "header"; group: string } | { type: "item"; cmd: Command; index: number }> = []
    let last = ""
    let idx = 0
    for (const c of ranked) {
      if (c.group !== last) {
        out.push({ type: "header", group: c.group })
        last = c.group
      }
      out.push({ type: "item", cmd: c, index: idx })
      idx += 1
    }
    return out
  }, [ranked])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector(
      `[data-cmd-idx="${activeIdx}"]`,
    ) as HTMLElement | null
    if (el) el.scrollIntoView({ block: "nearest" })
  }, [activeIdx, open])

  const execute = useCallback(
    async (cmd: Command) => {
      pushHistory(cmd.id)
      close()
      try {
        await cmd.run()
      } catch (err) {
        console.error("Command failed:", err)
      }
    },
    [close],
  )

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, ranked.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const cmd = ranked[activeIdx]
      if (cmd) void execute(cmd)
    }
  }

  if (!open) return null

  return ReactDOM.createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      className="fixed inset-0 z-2000 flex items-start justify-center pt-[12vh] bg-black/25 backdrop-blur-md"
    >
      <div
        className={cn(
          "w-160 max-w-[90vw] max-h-[60vh]",
          "bg-(--bg-card) border border-(--border) rounded-lg shadow-lg",
          "flex flex-col overflow-hidden",
          "animate-[modalIn_0.18s_var(--ease)]",
        )}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-(--border)">
          <Search className="w-4 h-4 text-(--text-tertiary)" />
          {/* Focus stays in the input while the arrow keys move a virtual
              cursor through the list, so the combobox pattern (rather than
              roving tabindex) is what screen readers need here:
              `aria-activedescendant` tells them which option is current. */}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("commandPalette.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={grouped.length > 0 ? optionId(activeIdx) : undefined}
            aria-autocomplete="list"
            aria-label={t("commandPalette.placeholder")}
            autoComplete="off"
            className="flex-1 bg-transparent border-0 outline-none text-[14px] text-(--text-primary) placeholder:text-(--text-tertiary)"
          />
          <kbd className="text-[10px] text-(--text-tertiary) bg-(--bg-input) px-1.5 py-0.5 rounded-sm">
            ESC
          </kbd>
        </div>

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t("commandPalette.placeholder")}
          className="m-0 p-1 list-none flex-1 overflow-y-auto"
        >
          {grouped.length === 0 && (
            <li role="presentation" className="px-4 py-6 text-center text-[12px] text-(--text-tertiary)">
              {t("commandPalette.empty")}
            </li>
          )}
          {grouped.map((entry, i) =>
            entry.type === "header" ? (
              <li
                key={`h:${entry.group}:${i}`}
                role="presentation"
                className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-(--text-tertiary) font-semibold"
              >
                {entry.group}
              </li>
            ) : (
              <li
                key={entry.cmd.id}
                id={optionId(entry.index)}
                role="option"
                aria-selected={entry.index === activeIdx}
                data-cmd-idx={entry.index}
                onClick={() => execute(entry.cmd)}
                onMouseMove={() => setActiveIdx(entry.index)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-sm cursor-pointer text-[12px]",
                  entry.index === activeIdx
                    ? "bg-(--accent) text-white"
                    : "text-(--text-primary) hover:bg-(--bg-input)",
                )}
              >
                <span className="shrink-0 opacity-80">{entry.cmd.icon}</span>
                <span className="flex-1 truncate">{entry.cmd.title}</span>
                {entry.cmd.subtitle && (
                  <span
                    className={cn(
                      "text-[11px] shrink-0",
                      entry.index === activeIdx
                        ? "text-white/80"
                        : "text-(--text-tertiary)",
                    )}
                  >
                    {entry.cmd.subtitle}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>

        <div className="flex items-center justify-between px-3 py-2 border-t border-(--border) text-[10px] text-(--text-tertiary)">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="bg-(--bg-input) px-1 py-0.5 rounded-sm mr-1">↑↓</kbd>
              {t("commandPalette.footer.navigate")}
            </span>
            <span>
              <kbd className="bg-(--bg-input) px-1 py-0.5 rounded-sm mr-1">⏎</kbd>
              {t("commandPalette.footer.run")}
            </span>
          </div>
          <span>
            <kbd className="bg-(--bg-input) px-1 py-0.5 rounded-sm mr-1">⌘K</kbd>
            {t("commandPalette.footer.toggle")}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
