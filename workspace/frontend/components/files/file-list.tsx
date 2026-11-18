"use client"

import { useState, useMemo } from "react"
import { Files, FolderOpen, FolderPlus, Search, Trash2 } from "lucide-react"
import { personalFolder } from '@/lib/personal-files'
import { useTeamRoster } from '@/hooks/use-team-roster'
import { HumanAvatar } from '@/components/chat/human-avatar'
import { useWorkspace } from "@/lib/workspace-context"
import { useLayout } from "@/components/layout/layout-context"
import { ListToggleButton } from "@/components/layout/list-collapse-button"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { dirname, isKeepFile } from "./file-utils"
import { FolderTreeRow } from "./folder-tree-row"
import { useFolderActions } from "./use-folder-actions"
import { FileStorageUsage } from "./file-storage-usage"

/** A section label in the panel: personal folders, folders, trash. */
function PanelSection({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("px-2 pb-1", className)}>
      <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
    </div>
  )
}

export function FileList() {
  const { files, selectedFileId, currentFilePath, pendingFolderPaths, trashEntries } = useWorkspace()
  const { filesSection } = useLayout()
  const t = useT()
  const team = useTeamRoster()
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
    return Array.from(fileCounts.entries()).filter(([path]) => path !== "people" && !team.some(person => personalFolder(person.email) === path))
      .map(([path, fileCount]) => ({
        path,
        count: fileCount + (childFolders.get(path)?.size || 0),
        depth: path.split("/").length - 1,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [files, team])

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

  const { openFolder, openTrash, createFolder, renameFolder, deleteFolder } = useFolderActions(folderPaths)

  const isFoldersSection = filesSection === "folders"
  // Delete actions, not files: a deleted folder counts once, the same way it
  // shows up in the Trash view as one restorable row.
  const trashCount = trashEntries.length

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* ── Header ── */}
      {/* Same shape as the Threads/Knowledge panels: a --header-height title row
          that lines up with the rail and the detail header, then the search on
          its own row below. */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b px-3">
        {/* No count here — this panel is about folders, and the detail header
            counts the files you're actually looking at. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <ListToggleButton className="-ml-1 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm leading-relaxed font-semibold">{t("files.title")}</span>
        </div>
        {/* This panel owns the folder structure; uploading a file belongs to
            the folder you're looking at, so it lives in the detail toolbar. */}
        <Button size="sm" className="shrink-0" onClick={() => createFolder()}>
          <FolderPlus data-icon="inline-start" />
          {t("folders.newFolder")}
        </Button>
      </div>

      {/* ── Search ── */}
      <div className="shrink-0 border-b px-3 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <Search className="size-3" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t("files.searchFoldersPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("files.searchFoldersLabel")}
            className="text-xs"
          />
        </InputGroup>
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
                ? "bg-muted"
                : "hover:bg-muted",
            )}
          >
            <Files className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sm font-medium">
              {t("files.allFiles")}
            </span>
          </button>
        )}

        <PanelSection label={t("files.personalFolders")} className="pt-3" />
        {team.filter(person => !search || `${person.displayName || ''} ${person.email}`.toLowerCase().includes(search.toLowerCase())).map(person => {
          const path = personalFolder(person.email)
          return <button key={person.email} type="button" onClick={() => openFolder(path)} title={person.email}
            className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted', currentFilePath === path && filesSection === 'folders' && 'bg-muted')}>
            <HumanAvatar email={person.email} className="size-5" />
            <span className="truncate">{person.displayName || person.email}</span>
          </button>
        })}

        {/* The rule separates this section from the rows above; with the
            recent row hidden during a search there is less to separate. */}
        <PanelSection
          label={t("folders.sectionLabel")}
          className={search ? "pt-1" : "mt-3 border-t pt-3"}
        />

        {folders.map((folder) => (
          <FolderTreeRow
            key={folder.path}
            path={folder.path}
            depth={folder.depth}
            count={folder.count}
            active={isFoldersSection && currentFilePath === folder.path && !selectedFileId}
            pending={pendingFolderPaths.get(folder.path)}
            onOpen={() => openFolder(folder.path)}
            onCreateInside={() => createFolder(folder.path)}
            onRename={() => renameFolder(folder.path)}
            onDelete={() => deleteFolder(folder.path, folder.count)}
          />
        ))}

        {folders.length === 0 && (
          <Empty className="px-4 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen />
              </EmptyMedia>
              <EmptyTitle>{search ? t("folders.noMatches") : t("folders.empty")}</EmptyTitle>
              <EmptyDescription>{search ? t("folders.noMatchesHint") : t("folders.emptyHint")}</EmptyDescription>
            </EmptyHeader>
            {!search && (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => createFolder()}>
                  <FolderPlus data-icon="inline-start" />
                  {t("folders.newFolder")}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        )}

        {/* ── Trash ── */}
        {/* Its own section rather than a folder row: it isn't a place files
            live, and what it holds can't be browsed into. */}
        {!search && (
          <>
            <PanelSection label={t("trash.title")} className="mt-3 border-t pt-3" />
            <button
              type="button"
              onClick={openTrash}
              className={cn(
                // pr-9, not pr-2: a folder row's count is pushed in by its
                // actions button (size-6 + me-1) even while that button is
                // invisible. This row has no menu, so it reserves the same
                // 28px and every count in the panel lines up on one edge.
                "w-full flex items-center gap-2.5 py-2 pl-2 pr-9 rounded-lg text-left transition-colors cursor-pointer",
                filesSection === "trash"
                  ? "bg-muted"
                  : "hover:bg-muted",
              )}
            >
              <Trash2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm font-medium">
                {t("trash.recentlyDeleted")}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {trashCount || ""}
              </span>
            </button>
          </>
        )}
      </div>
      <FileStorageUsage />
    </div>
  )
}
