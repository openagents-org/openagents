"use client"

import { Folder, FolderPlus, MoreVertical, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { FolderOpKind } from "@/lib/workspace-context"
import { basename } from "./file-utils"

/**
 * One folder in the panel's tree, indented by depth, with its direct item
 * count and a menu to nest, rename or delete it.
 */
export function FolderTreeRow({
  path,
  depth,
  count,
  active,
  pending,
  onOpen,
  onCreateInside,
  onRename,
  onDelete,
}: {
  path: string
  depth: number
  count: number
  active: boolean
  /** Create and rename show up instantly and are still on their way to the
   *  server; the spinner says "not saved yet" without blocking the click. */
  pending?: FolderOpKind
  onOpen: () => void
  onCreateInside: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const t = useT()
  const name = basename(path)
  return (
    <div
      className={cn("group flex items-center rounded-lg transition-colors", active ? "bg-muted" : "hover:bg-muted")}
      style={{ paddingInlineStart: `${depth * 0.75}rem` }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-2 text-left"
      >
        <Folder className="size-4 shrink-0 text-warning" />
        <span className={cn("flex-1 truncate text-sm font-medium transition-opacity", pending && "opacity-60")}>
          {name}
        </span>
        {pending ? (
          <Spinner
            className="size-3 shrink-0 text-muted-foreground"
            aria-label={pending === "create" ? t("common.creating") : t("common.saving")}
          />
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{count || ""}</span>
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={Boolean(pending)}
            aria-label={t("folders.actionsFor", { name })}
            className="me-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-0 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onCreateInside}>
              <FolderPlus />
              {t("folders.newFolderInside")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil />
              {t("common.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
