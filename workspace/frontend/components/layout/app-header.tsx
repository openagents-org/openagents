"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MessageSquare, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useWorkspace } from "@/lib/workspace-context"
import { cn } from "@/lib/utils"
import { useLayout, type ViewMode } from "./layout-context"

const ACTIONS_SLOT_ID = "app-header-actions"
const TITLE_SLOT_ID = "app-header-title"

/** Portals children into one of the app header's slots. */
function HeaderSlot({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  // The header renders before any detail view, so the slot exists by the time
  // this effect runs; re-checking on every render keeps it correct across
  // view switches that remount the header.
  useEffect(() => {
    setSlot(document.getElementById(id))
  })

  return slot ? createPortal(children, slot) : null
}

/**
 * Renders its children into the app header's action toolbar. Each view keeps
 * owning its own header logic and state — only the render target moves — so
 * the shell shows the single action header the app-shell-4 layout calls for.
 */
export function AppHeaderActions({ children }: { children: React.ReactNode }) {
  return <HeaderSlot id={ACTIONS_SLOT_ID}>{children}</HeaderSlot>
}

/**
 * Replaces the app header's title. Views only need this when their title is
 * interactive (file breadcrumbs, for instance) — otherwise {@link AppHeader}
 * derives the title itself.
 */
export function AppHeaderTitle({ children }: { children: React.ReactNode }) {
  return <HeaderSlot id={TITLE_SLOT_ID}>{children}</HeaderSlot>
}

/**
 * Header for a detail view. On desktop the shell owns a single app-shell-4
 * action header: the title is rendered there by {@link AppHeader} and only the
 * actions are portalled up. On mobile there is no app header, so the view keeps
 * rendering its own bar with both.
 */
export function DetailHeader({
  title,
  titleInHeader = false,
  children,
}: {
  title: React.ReactNode
  /**
   * Render `title` in the app header too, replacing the title it would derive
   * itself. For views whose title is interactive, like file breadcrumbs.
   */
  titleInHeader?: boolean
  children?: React.ReactNode
}) {
  const { isMobile } = useLayout()

  if (!isMobile) {
    return (
      <>
        {titleInHeader && <AppHeaderTitle>{title}</AppHeaderTitle>}
        <AppHeaderActions>{children}</AppHeaderActions>
      </>
    )
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 lg:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-3">
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
        {children}
      </div>
    </div>
  )
}

const VIEW_TITLES: Record<ViewMode, string> = {
  threads: "Threads",
  files: "Files",
  knowledge: "Knowledge",
  browser: "Browser",
  tasks: "Tasks",
  routines: "Routines",
  inbox: "Inbox",
  connect: "Connect Agent",
  skills: "Skill Hub",
}

/** Editable thread title — click to rename, Enter/blur to commit. */
function ThreadTitle() {
  const { sessions, currentSessionId, renameSession } = useWorkspace()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const isDM = currentSessionId?.startsWith("dm:") ?? false
  const session = sessions.find((s) => s.sessionId === currentSessionId)

  if (isDM) {
    return (
      <h3 className="flex w-0 flex-1 items-center gap-1.5 truncate text-sm leading-snug font-semibold text-foreground">
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        {currentSessionId!
          .slice(3)
          .split(",")
          .map((a) => a.replace(/^openagents:/, ""))
          .join(" ↔ ")}
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          read-only
        </span>
      </h3>
    )
  }

  const startEditing = () => {
    setDraft(session?.title || "")
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && currentSessionId && trimmed !== session?.title) {
      renameSession(currentSessionId, trimmed)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") setEditing(false)
        }}
        className="w-0 min-w-0 flex-1 border-b border-primary bg-transparent text-sm font-semibold outline-none"
        autoFocus
      />
    )
  }

  return (
    <h3
      onClick={startEditing}
      title="Click to rename"
      className="w-0 flex-1 cursor-pointer truncate text-sm leading-snug font-semibold text-foreground transition-colors hover:text-primary"
    >
      {session?.title || "Thread"}
    </h3>
  )
}

/**
 * The app-shell-4 action header: expand-list control, the selected item's
 * title, and a toolbar that the active view fills via {@link AppHeaderActions}.
 */
export function AppHeader() {
  const { viewMode, isSidebarOpen, setSidebarOpen, hasListPanel } = useLayout()
  const {
    files,
    selectedFileId,
    currentFilePath,
    browserTabs,
    selectedBrowserTabId,
    knowledge,
    selectedKnowledgeId,
  } = useWorkspace()

  // Title: the selected item for list-backed views, the view name otherwise.
  let title: React.ReactNode
  if (viewMode === "threads" || viewMode === "routines") {
    title = <ThreadTitle />
  } else if (viewMode === "files") {
    const name =
      files.find((f) => f.id === selectedFileId)?.filename || currentFilePath
    title = (
      <h3 className="w-0 flex-1 truncate text-sm leading-snug font-semibold text-foreground">
        {name || VIEW_TITLES.files}
      </h3>
    )
  } else if (viewMode === "knowledge") {
    const entry = knowledge.find((k) => k.id === selectedKnowledgeId)
    title = (
      <h3 className="w-0 flex-1 truncate text-sm leading-snug font-semibold text-foreground">
        {VIEW_TITLES.knowledge}
      </h3>
    )
  } else if (viewMode === "browser") {
    const tab = browserTabs.find((t) => t.id === selectedBrowserTabId)
    title = (
      <h3 className="w-0 flex-1 truncate text-sm leading-snug font-semibold text-foreground">
        {tab?.title || tab?.url || VIEW_TITLES.browser}
      </h3>
    )
  } else {
    title = (
      <h3 className="w-0 flex-1 truncate text-sm leading-snug font-semibold text-foreground">
        {VIEW_TITLES[viewMode]}
      </h3>
    )
  }

  return (
    <header
      className={cn(
        "flex h-(--header-height) min-w-0 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5",
        "sm:gap-1.5 sm:px-4",
      )}
    >
      {/* Bring the list back when it has been collapsed away */}
      {hasListPanel && !isSidebarOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              aria-label="Show list"
              onClick={() => setSidebarOpen(true)}
              className="shrink-0 text-muted-foreground"
            >
              <PanelLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show list</TooltipContent>
        </Tooltip>
      )}

      {/* Title slot. The derived title is a fallback: once a view portals its
          own title in, the fallback is no longer the only child and hides. */}
      <div
        id={TITLE_SLOT_ID}
        className="flex w-0 flex-1 items-center gap-2 [&>[data-header-title-fallback]:not(:only-child)]:hidden"
      >
        <div data-header-title-fallback className="contents">
          {title}
        </div>
      </div>

      {/* Filled by the active view through <AppHeaderActions> */}
      <div
        id={ACTIONS_SLOT_ID}
        role="toolbar"
        aria-label="View actions"
        className="ml-auto flex shrink-0 items-center gap-1"
      />
    </header>
  )
}
