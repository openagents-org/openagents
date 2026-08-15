"use client"

import { useState, useMemo } from "react"
import {
  Search,
  Clock,
  FolderOpen,
  Folder,
  FolderPlus,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react"
import { useWorkspace } from "@/lib/workspace-context"
import { useLayout } from "@/components/layout/layout-context"
import { useConfirm, usePrompt } from "@/components/ui/dialogs-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useT } from "@/lib/i18n"
import { basename, dirname, isKeepFile } from "./file-utils"

interface FolderNode {
  path: string
  depth: number
  count: number
}

/**
 * Longest folder name we accept.
 *
 * The panel is a fixed-width column and a folder name is one line of it —
 * past this everything is ellipsis, and a tree of truncated names is a tree
 * you can't read. Nesting multiplies it: the full path travels in every
 * filename, and the breadcrumb has to spell it out.
 */
const MAX_FOLDER_NAME = 20

export function FileList() {
  const {
    files,
    selectedFileId,
    setSelectedFileId,
    currentFilePath,
    setCurrentFilePath,
    createFolder,
    renameFolder,
    deleteFolder,
    pendingFolderPaths,
    trashEntries,
  } = useWorkspace()
  const { isMobile, openMobileDetail, filesSection, setFilesSection } =
    useLayout()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const t = useT()
  const [search, setSearch] = useState("")

  /**
   * Every folder in the workspace, flattened to a full path with its depth.
   * Folders only exist as a path prefix on `filename`, so they're derived here
   * rather than fetched — including ancestors that hold nothing directly, so a
   * nested folder is always reachable.
   *
   * The count is what's directly inside: files plus subfolders, the same
   * items the detail pane lists. Counting the whole subtree instead would put
   * a different number here than the pane shows for the same folder.
   */
  const allFolders = useMemo(() => {
    const fileCounts = new Map<string, number>()
    const childFolders = new Map<string, Set<string>>()
    for (const file of files) {
      const dir = dirname(file.filename)
      if (!dir) continue
      const isKeep = isKeepFile(file.filename)
      const segments = dir.split("/")
      for (let i = 0; i < segments.length; i++) {
        const path = segments.slice(0, i + 1).join("/")
        const isLeaf = i === segments.length - 1
        fileCounts.set(
          path,
          (fileCounts.get(path) || 0) + (isLeaf && !isKeep ? 1 : 0),
        )
        if (!isLeaf) {
          const children = childFolders.get(path) || new Set<string>()
          children.add(segments[i + 1])
          childFolders.set(path, children)
        }
      }
    }
    return Array.from(fileCounts.entries())
      .map(([path, fileCount]) => ({
        path,
        count: fileCount + (childFolders.get(path)?.size || 0),
        depth: path.split("/").length - 1,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [files])

  const folders = useMemo(() => {
    if (!search) return allFolders
    const q = search.toLowerCase()
    return allFolders.filter((f) => f.path.toLowerCase().includes(q))
  }, [allFolders, search])

  /** Every folder path, so a name clash is caught while the user is still
   *  typing it rather than by the server two seconds later. */
  const folderPaths = useMemo(
    () => new Set(allFolders.map((f) => f.path)),
    [allFolders],
  )

  const openFolder = (path: string) => {
    setFilesSection("folders")
    setCurrentFilePath(path)
    // Drop any open file so the detail pane shows the folder, not a preview
    setSelectedFileId(null)
    if (isMobile) openMobileDetail()
  }

  const openTrash = () => {
    setFilesSection("trash")
    setSelectedFileId(null)
    if (isMobile) openMobileDetail()
  }

  /** A path segment can't hold a separator; it would nest a folder instead. */
  const sanitizeName = (name: string) => name.trim().replace(/[/\\]/g, "-")

  /**
   * Names are checked before the folder exists, so the limit is a rule rather
   * than a truncation: a name cut down to fit is a different name than the one
   * you typed, and you'd only find out after it was created.
   */
  const checkName = (value: string, taken: (path: string) => boolean) => {
    const candidate = sanitizeName(value)
    if (candidate.length > MAX_FOLDER_NAME) {
      return t("folders.nameTooLong", {
        max: MAX_FOLDER_NAME,
        length: candidate.length,
      })
    }
    return taken(candidate) ? t("folders.nameTaken") : null
  }

  /**
   * Create a folder under `parent` — the top level by default.
   *
   * The parent is passed in rather than read off the selection: the header
   * button is the panel's own action and always makes a top-level folder,
   * while a row's menu makes one inside that row. Taking it from whatever
   * happened to be selected left no way to get back to the top level at all.
   */
  const handleCreateFolder = async (parent = "") => {
    const name = await prompt({
      title: parent
        ? t("folders.newFolderIn", { parent: basename(parent) })
        : t("folders.newFolder"),
      description: parent
        ? t("folders.createdInside", { parent })
        : t("folders.createdAtTopLevel"),
      placeholder: t("folders.namePlaceholder"),
      confirmText: t("common.create"),
      validate: (value) =>
        checkName(value, (candidate) =>
          folderPaths.has(parent ? `${parent}/${candidate}` : candidate),
        ),
    })
    if (!name?.trim()) return
    const sanitized = sanitizeName(name)
    const path = parent ? `${parent}/${sanitized}` : sanitized

    // The folder is on screen — and open — before the request goes out; if it
    // fails it disappears again, so the view has to leave with it.
    const previousPath = currentFilePath
    const previousSection = filesSection
    openFolder(path)
    try {
      await createFolder(path)
    } catch (err) {
      setFilesSection(previousSection)
      setCurrentFilePath(previousPath)
      toast.error(
        err instanceof Error ? err.message : t("folders.createFailed"),
      )
    }
  }

  const handleRenameFolder = async (path: string) => {
    const currentName = basename(path)
    const parent = dirname(path)
    const next = await prompt({
      title: t("folders.renameTitle"),
      description: t("folders.renameDescription"),
      defaultValue: currentName,
      placeholder: t("folders.namePlaceholder"),
      confirmText: t("common.rename"),
      validate: (value) =>
        checkName(value, (candidate) =>
          // Its own name isn't taken — leaving it alone is a no-op, not a clash.
          candidate !== currentName &&
          folderPaths.has(parent ? `${parent}/${candidate}` : candidate),
        ),
    })
    if (!next?.trim()) return
    const sanitized = sanitizeName(next)
    if (sanitized === currentName) return
    const newPath = parent ? `${parent}/${sanitized}` : sanitized

    // Follow the folder if we were standing in it (or below it), and follow it
    // back if the rename doesn't take.
    const previousPath = currentFilePath
    const wasInside =
      currentFilePath === path || currentFilePath.startsWith(`${path}/`)
    if (wasInside)
      setCurrentFilePath(newPath + currentFilePath.slice(path.length))
    try {
      await renameFolder(path, newPath)
    } catch (err) {
      if (wasInside) setCurrentFilePath(previousPath)
      toast.error(
        err instanceof Error ? err.message : t("folders.renameFailed"),
      )
    }
  }

  const handleDeleteFolder = async (path: string, count: number) => {
    const ok = await confirm({
      title: t("folders.deleteTitle"),
      description:
        count > 0
          ? t("folders.deleteDescriptionWithItems", {
              name: basename(path),
              count: t("folders.itemCount", { count }),
            })
          : t("folders.deleteDescription", { name: basename(path) }),
      confirmText: t("common.delete"),
      destructive: true,
    })
    if (!ok) return

    const previousPath = currentFilePath
    const wasInside =
      currentFilePath === path || currentFilePath.startsWith(`${path}/`)
    if (wasInside) openFolder(dirname(path))
    try {
      await deleteFolder(path)
      toast.success(t("files.movedToTrash", { name: basename(path) }))
    } catch (err) {
      if (wasInside) setCurrentFilePath(previousPath)
      toast.error(
        err instanceof Error ? err.message : t("folders.deleteFailed"),
      )
    }
  }

  const isFoldersSection = filesSection === "folders"
  // Delete actions, not files: a deleted folder counts once, the same way it
  // shows up in the Trash view as one restorable row.
  const trashCount = trashEntries.length

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      {/* Same shape as the Threads/Knowledge panels: a --header-height title row
          that lines up with the rail and the detail header, then the search on
          its own row below. */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        {/* No count here — this panel is about folders, and the detail header
            counts the files you're actually looking at. */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm leading-relaxed font-semibold">{t("files.title")}</span>
        </div>

        {/* This panel owns the folder structure; uploading a file belongs to
            the folder you're looking at, so it lives in the detail toolbar. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                aria-label={t("files.newTopLevelFolder")}
                onClick={() => handleCreateFolder()}
                className="text-muted-foreground"
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("files.newTopLevelFolder")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            placeholder={t("files.searchFoldersPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("files.searchFoldersLabel")}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* ── Folders ── */}
      {/* The panel is navigation only: pick a folder here, see its contents in
          the detail pane. A recency list here duplicated the grid and mixed
          files from every folder together. */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {/* ── Recent files ── */}
        {/* The detail pane's default view, given a row of its own so it can be
            returned to. On mobile the two are separate screens, and without
            this the folder list was a one-way door: once you picked a folder
            there was no way back to the recent listing. Hidden while searching,
            which is a search of folders. */}
        {!search && (
          <button
            type="button"
            onClick={() => openFolder("")}
            className={cn(
              // pr-9 for the same reason as the trash row: it lines this row's
              // right edge up with the folder counts above it.
              "w-full flex items-center gap-2.5 py-2 pl-2 pr-9 rounded-lg text-left transition-colors cursor-pointer",
              isFoldersSection && !currentFilePath && !selectedFileId
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
            )}
          >
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-[13px] font-medium">
              {t("files.recentFiles")}
            </span>
          </button>
        )}

        <div
          className={cn(
            "px-2 pb-1",
            // The rule separates this section from the recent row; with that
            // row hidden during a search there is nothing above to separate.
            search ? "pt-1" : "mt-3 border-t border-border/60 pt-3",
          )}
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("folders.sectionLabel")}
          </span>
        </div>

        {folders.map((folder) => {
          const isActive =
            isFoldersSection &&
            currentFilePath === folder.path &&
            !selectedFileId
          // Create and rename show up instantly and are still on their way to
          // the server; the spinner is what says "not saved yet" without taking
          // the row away or blocking the click that opens it.
          const pending = pendingFolderPaths.get(folder.path)
          return (
            <div
              key={folder.path}
              className={cn(
                "group flex items-center rounded-lg transition-colors",
                isActive
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
              )}
              style={{ paddingLeft: `${folder.depth * 12}px` }}
            >
              <button
                type="button"
                onClick={() => openFolder(folder.path)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-2 text-left"
              >
                <Folder className="size-4 shrink-0 text-amber-500" />
                <span
                  className={cn(
                    "flex-1 truncate text-[13px] font-medium transition-opacity",
                    pending && "opacity-60",
                  )}
                >
                  {basename(folder.path)}
                </span>
                {pending ? (
                  <Loader2
                    className="size-3 shrink-0 animate-spin text-muted-foreground"
                    aria-label={pending === "create" ? t("common.creating") : t("common.saving")}
                  />
                ) : (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {folder.count || ""}
                  </span>
                )}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    disabled={Boolean(pending)}
                    aria-label={t("folders.actionsFor", { name: basename(folder.path) })}
                    className="mr-1 size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100 disabled:opacity-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onSelect={() => handleCreateFolder(folder.path)}
                  >
                    <FolderPlus className="size-4" />
                    {t("folders.newFolderInside")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => handleRenameFolder(folder.path)}
                  >
                    <Pencil className="size-4" />
                    {t("common.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      handleDeleteFolder(folder.path, folder.count)
                    }
                  >
                    <Trash2 className="size-4" />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        })}

        {folders.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
            <FolderOpen className="size-9 opacity-30" />
            <p className="text-sm font-medium">
              {search ? t("folders.noMatches") : t("folders.empty")}
            </p>
            <p className="text-xs">
              {search ? t("folders.noMatchesHint") : t("folders.emptyHint")}
            </p>
            {!search && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => handleCreateFolder()}
              >
                <FolderPlus className="size-3.5" />
                {t("folders.newFolder")}
              </Button>
            )}
          </div>
        )}

        {/* ── Trash ── */}
        {/* Its own section rather than a folder row: it isn't a place files
            live, and what it holds can't be browsed into. */}
        {!search && (
          <>
            <div className="mt-3 border-t border-border/60 px-2 pt-3 pb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("trash.title")}
              </span>
            </div>
            <button
              type="button"
              onClick={openTrash}
              className={cn(
                // pr-9, not pr-2: a folder row's count is pushed in by its
                // actions button (size-6 + mr-1) even while that button is
                // invisible. This row has no menu, so it reserves the same
                // 28px and every count in the panel lines up on one edge.
                "w-full flex items-center gap-2.5 py-2 pl-2 pr-9 rounded-lg text-left transition-colors cursor-pointer",
                filesSection === "trash"
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
              )}
            >
              <Trash2 className="size-4 shrink-0 text-muted-foreground text-red-500" />
              <span className="flex-1 truncate text-[13px] font-medium">
                {t("trash.recentlyDeleted")}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {trashCount || ""}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
