import { useMemo } from "react"
import {
  Cpu,
  Download,
  FileText,
  Folder,
  Github,
  LayoutDashboard,
  Layers,
  Monitor,
  Moon,
  Play,
  Plus,
  Settings,
  Square,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { useUiStore } from "@renderer/store/ui"
import { useAgentsStore } from "@renderer/store/agents"
import { useThemeStore, type ThemeMode } from "@renderer/store/theme"

export interface Command {
  id: string
  title: string
  subtitle?: string
  group: string
  icon: LucideIcon
  run: () => void | Promise<void>
}

// No `credentials` entry: the page is unfinished, so it is deliberately
// unreachable from the UI. Re-add here, in SHORTCUT_TABS and in the Settings →
// Agents section when it ships.
const NAV_TABS: Array<[id: string, icon: LucideIcon]> = [
  ["dashboard", LayoutDashboard],
  ["agents", Cpu],
  ["workspaces", Layers],
  // `connections` is hidden alongside its rail entry until the platform
  // options actually work (see nav-config.ts).
  ["github", Github],
  ["install", Download],
  ["logs", FileText],
  ["settings", Settings],
]

const THEME_ICON: Record<ThemeMode, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const RUNNING_STATES = ["online", "running", "idle"]

/** Every command the palette can run, in a stable order (groups stay together). */
export function useCommands(): Command[] {
  const { t } = useTranslation()
  const { setCurrentTab, goToInstallList, requestCreate } = useUiStore(
    useShallow((s) => ({
      setCurrentTab: s.setCurrentTab,
      goToInstallList: s.goToInstallList,
      requestCreate: s.requestCreate,
    })),
  )
  const agents = useAgentsStore((s) => s.agents)
  const { mode, setMode } = useThemeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode })),
  )

  return useMemo(() => {
    const nav: Command[] = NAV_TABS.map(([id, icon]) => ({
      id: `nav:${id}`,
      title: t("commandPalette.commands.goTo", {
        label: t(`commandPalette.nav.${id}`),
      }),
      group: t("commandPalette.groups.navigation"),
      icon,
      run: () => (id === "install" ? goToInstallList() : setCurrentTab(id)),
    }))

    const agentCmds = agents.flatMap((a): Command[] => {
      const running = RUNNING_STATES.includes(a.state)
      return [
        {
          id: `agent:open:${a.name}`,
          title: t("commandPalette.commands.openAgent", { name: a.name }),
          subtitle: a.type,
          group: t("commandPalette.groups.agents"),
          icon: Cpu,
          // Agents page only. `setInstallFocusAgent` used to be called here
          // too, but nothing on this page reads it — it just left a marketplace
          // deep-link armed, to fire on some later, unrelated visit there.
          run: () => setCurrentTab("agents"),
        },
        running
          ? {
              id: `agent:stop:${a.name}`,
              title: t("commandPalette.commands.stopAgent", { name: a.name }),
              group: t("commandPalette.groups.agents"),
              icon: Square,
              run: () => void window.api.stopAgent(a.name),
            }
          : {
              id: `agent:start:${a.name}`,
              title: t("commandPalette.commands.startAgent", { name: a.name }),
              group: t("commandPalette.groups.agents"),
              icon: Play,
              run: () => void window.api.startAgent(a.name),
            },
      ]
    })

    const group = t("commandPalette.groups.actions")
    const actions: Command[] = [
      { id: "action:start-all", title: t("commandPalette.commands.startAll"), group, icon: Play, run: () => void window.api.startAll() },
      { id: "action:stop-all", title: t("commandPalette.commands.stopAll"), group, icon: Square, run: () => void window.api.stopAll() },
      { id: "action:install-agent", title: t("commandPalette.commands.installAgent"), group, icon: Plus, run: () => goToInstallList() },
      // Opens the Workspaces page with its join dialog: the launcher joins an
      // existing workspace by code, it never creates one.
      { id: "action:add-workspace", title: t("commandPalette.commands.addWorkspace"), group, icon: Folder, run: () => requestCreate("workspace") },
    ]

    const themes: Command[] = (["light", "dark", "system"] as ThemeMode[]).map((m) => ({
      id: `theme:${m}`,
      title: t("commandPalette.commands.theme", {
        mode: t(`commandPalette.themes.${m}`),
      }),
      subtitle: mode === m ? t("commandPalette.current") : undefined,
      group: t("commandPalette.groups.appearance"),
      icon: THEME_ICON[m],
      run: () => setMode(m),
    }))

    return [...nav, ...agentCmds, ...actions, ...themes]
  }, [agents, setCurrentTab, goToInstallList, requestCreate, mode, setMode, t])
}
