"use client"

import { toast } from "sonner"
import { useLayout } from "@/components/layout/layout-context"
import { useConfirm, usePrompt } from "@/components/ui/dialogs-provider"
import { useT } from "@/lib/i18n"
import { useWorkspace } from "@/lib/workspace-context"
import { basename, dirname } from "./file-utils"

/**
 * Longest folder name we accept.
 *
 * The panel is a fixed-width column and a folder name is one line of it —
 * past this everything is ellipsis, and a tree of truncated names is a tree
 * you can't read. Nesting multiplies it: the full path travels in every
 * filename, and the breadcrumb has to spell it out.
 */
const MAX_FOLDER_NAME = 20

/**
 * Moving around the folder panel and changing its structure: open a folder or
 * the trash, and create, rename or delete a folder. Each change is applied on
 * screen before the request goes out and rolled back if it fails, so the view
 * follows the folder it touched.
 *
 * `folderPaths` is every folder that exists, so a name clash is caught while
 * the user is still typing rather than by the server two seconds later.
 */
export function useFolderActions(folderPaths: Set<string>) {
  const {
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
  const t = useT()

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

  return {
    openFolder,
    openTrash,
    createFolder: handleCreateFolder,
    renameFolder: handleRenameFolder,
    deleteFolder: handleDeleteFolder,
  }
}
