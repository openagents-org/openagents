"use client"

import { useState, useMemo } from "react"
import {
  Search,
  FolderOpen,
  Folder,
  FolderPlus,
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
import { basename, dirname } from "./file-utils"
import { useTrashCount } from "./trash-view"

interface FolderNode {
  path: string
  depth: number
  count: number
}

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
  } = useWorkspace()
  const { isMobile, openMobileDetail, filesSection, setFilesSection } = useLayout()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const [search, setSearch] = useState("")

  /**
   * Every folder in the workspace, flattened to a full path with its depth.
   * Folders only exist as a path prefix on `filename`, so they're derived here
   * rather than fetched — including ancestors that hold nothing directly, so a
   * nested folder is always reachable.
   */
  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const file of files) {
      const dir = dirname(file.filename)
      if (!dir) continue
      const isKeep = basename(file.filename) === ".keep"
      const segments = dir.split("/")
      for (let i = 0; i < segments.length; i++) {
        const path = segments.slice(0, i + 1).join("/")
        const isLeaf = i === segments.length - 1
        counts.set(path, (counts.get(path) || 0) + (isLeaf && !isKeep ? 1 : 0))
      }
    }
    const all: FolderNode[] = Array.from(counts.entries())
      .map(([path, count]) => ({
        path,
        count,
        depth: path.split("/").length - 1,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))

    if (!search) return all
    const q = search.toLowerCase()
    return all.filter((f) => f.path.toLowerCase().includes(q))
  }, [files, search])

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


  const handleCreateFolder = async () => {
    const name = await prompt({
      title: "New folder",
      description: currentFilePath
        ? `Created inside "${currentFilePath}".`
        : "Created at the top level.",
      placeholder: "Folder name",
      confirmText: "Create",
    })
    if (!name?.trim()) return
    const sanitized = name.trim().replace(/[/\\]/g, "-")
    const path = currentFilePath ? `${currentFilePath}/${sanitized}` : sanitized
    try {
      await createFolder(path)
      toast.success(`Created "${sanitized}"`)
      openFolder(path)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create folder")
    }
  }

  const handleRenameFolder = async (path: string) => {
    const next = await prompt({
      title: "Rename folder",
      description: "Everything inside moves with it.",
      defaultValue: basename(path),
      placeholder: "Folder name",
      confirmText: "Rename",
    })
    if (!next?.trim()) return
    const sanitized = next.trim().replace(/[/\\]/g, "-")
    if (sanitized === basename(path)) return
    const parent = dirname(path)
    const newPath = parent ? `${parent}/${sanitized}` : sanitized
    try {
      await renameFolder(path, newPath)
      toast.success(`Renamed to "${sanitized}"`)
      // Follow the folder if we were standing in it (or below it)
      if (currentFilePath === path || currentFilePath.startsWith(`${path}/`)) {
        setCurrentFilePath(newPath + currentFilePath.slice(path.length))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename folder")
    }
  }

  const handleDeleteFolder = async (path: string, count: number) => {
    const ok = await confirm({
      title: "Delete folder?",
      description:
        count > 0
          ? `"${basename(path)}" and its ${count} ${count === 1 ? "file" : "files"} will be deleted.`
          : `"${basename(path)}" will be deleted.`,
      confirmText: "Delete",
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteFolder(path)
      toast.success(`Deleted "${basename(path)}"`)
      if (currentFilePath === path || currentFilePath.startsWith(`${path}/`)) {
        openFolder(dirname(path))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete folder")
    }
  }

  const isFoldersSection = filesSection === "folders"
  const trashCount = useTrashCount()

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
          <span className="text-sm leading-relaxed font-semibold">Files</span>
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
                aria-label="New folder"
                onClick={handleCreateFolder}
                className="text-muted-foreground"
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New folder</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            placeholder="Search folders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search folders"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* ── Folders ── */}
      {/* The panel is navigation only: pick a folder here, see its contents in
          the detail pane. A recency list here duplicated the grid and mixed
          files from every folder together. */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        <div className="px-2 pt-1 pb-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Folders
          </span>
        </div>

        {folders.map((folder) => {
          const isActive =
            isFoldersSection && currentFilePath === folder.path && !selectedFileId
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
                <span className="flex-1 truncate text-[13px] font-medium">
                  {basename(folder.path)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {folder.count || ""}
                </span>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    aria-label={`Actions for ${basename(folder.path)}`}
                    className="mr-1 size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onSelect={() => handleRenameFolder(folder.path)}>
                    <Pencil className="size-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => handleDeleteFolder(folder.path, folder.count)}
                  >
                    <Trash2 className="size-4" />
                    Delete
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
              {search ? "No folders match" : "No folders yet"}
            </p>
            <p className="text-xs">
              {search
                ? "Try a different search term"
                : "Create one to organise your files."}
            </p>
            {!search && (
              <Button variant="outline" size="sm" className="mt-1" onClick={handleCreateFolder}>
                <FolderPlus className="size-3.5" />
                New folder
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
                Trash
              </span>
            </div>
            <button
              type="button"
              onClick={openTrash}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors cursor-pointer",
                filesSection === "trash"
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
              )}
            >
              <Trash2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px] font-medium">
                Recently deleted
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
