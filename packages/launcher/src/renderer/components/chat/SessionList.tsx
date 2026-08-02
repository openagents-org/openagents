import React, { useMemo, useState } from "react"
import { Plus, Search, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { cn } from "../../lib/utils"
import { Button } from "../shadcn/button"
import type { ChatSessionMeta, Workspace } from "../../types"

interface SessionListProps {
  workspaces: Workspace[]
  sessions: ChatSessionMeta[]
  activeKey: string | null
  selectedWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSession: (workspaceId: string, channelName: string) => void
  onDeleteSession: (workspaceId: string, channelName: string) => void
  onClearAll: () => void
  onNewChat: () => void
}

function relativeTime(iso: string | null, t: TFunction): string {
  if (!iso) return ""
  const parsed = Date.parse(iso)
  if (!parsed) return ""
  const diff = Date.now() - parsed
  if (diff < 60_000) return t("chat.sessionList.justNow")
  if (diff < 3_600_000) return t("chat.sessionList.minAgo", { count: Math.round(diff / 60_000) })
  if (diff < 86_400_000) return t("chat.sessionList.hoursAgo", { count: Math.round(diff / 3_600_000) })
  if (diff < 86_400_000 * 7) return t("chat.sessionList.daysAgo", { count: Math.round(diff / 86_400_000) })
  return new Date(iso).toLocaleDateString()
}

export default function SessionList({
  workspaces,
  sessions,
  activeKey,
  selectedWorkspaceId,
  onSelectWorkspace,
  onSelectSession,
  onDeleteSession,
  onClearAll,
  onNewChat,
}: SessionListProps): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")

  const visible = useMemo(() => {
    const base = selectedWorkspaceId
      ? sessions.filter((s) => s.workspaceId === selectedWorkspaceId)
      : sessions
    const q = query.trim().toLowerCase()
    if (!q) return base
    return base.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.channelName.toLowerCase().includes(q) ||
        (s.lastMessagePreview || "").toLowerCase().includes(q),
    )
  }, [sessions, selectedWorkspaceId, query])

  return (
    <aside className="w-75 shrink-0 h-full border-r border-(--border) bg-(--bg-card) flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold tracking-tight text-(--text-primary)">
          {t("chat.sessionList.title")}
        </h2>
        <div className="flex items-center gap-1">
          {selectedWorkspaceId && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClearAll}
              title={t("chat.sessionList.clearAll")}
              className="h-7 w-7 text-(--text-tertiary) hover:enabled:text-(--danger-text)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            onClick={onNewChat}
            disabled={!selectedWorkspaceId}
            title={t("chat.sessionList.newChat")}
            className="h-7 w-7"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Workspace picker (compact) */}
      <div className="px-4 mb-2">
        <select
          value={selectedWorkspaceId || ""}
          onChange={(e) => onSelectWorkspace(e.target.value)}
          className={cn(
            "w-full text-xs px-3 py-2 rounded-(--radius-sm) outline-none",
            "bg-(--bg-input) border border-transparent text-(--text-primary)",
            "focus:border-(--accent) focus:bg-(--bg-card)",
          )}
        >
          <option value="">{t("chat.sessionList.selectWorkspace")}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name || w.slug}
            </option>
          ))}
        </select>
      </div>

      {/* Search */}
      <div className="px-4 mb-2">
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-(--radius-sm)",
            "bg-(--bg-input) border border-transparent focus-within:border-(--accent) focus-within:bg-(--bg-card)",
          )}
        >
          <Search className="w-3.5 h-3.5 text-(--text-tertiary)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chat.sessionList.searchPlaceholder")}
            className="bg-transparent border-0 outline-none flex-1 text-xs text-(--text-primary) placeholder:text-(--text-tertiary)"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {visible.length === 0 ? (
          <div className="px-3 py-8 text-xs text-(--text-tertiary) text-center">
            {sessions.length === 0
              ? t("chat.sessionList.noSavedSessions")
              : t("chat.sessionList.noMatches")}
          </div>
        ) : (
          visible.map((s) => {
            const key = `${s.workspaceId}:${s.channelName}`
            const active = activeKey === key
            const ws = workspaces.find(
              (w) => w.id === s.workspaceId || w.slug === s.workspaceId,
            )
            const wsLabel = ws?.name || ws?.slug || s.workspaceId
            return (
              <div
                key={key}
                onClick={() => onSelectSession(s.workspaceId, s.channelName)}
                className={cn(
                  "group cursor-pointer rounded-(--radius-sm) px-3 py-2.5 mb-1 transition-colors relative",
                  active
                    ? "bg-(--accent-bg) border border-(--accent-border)"
                    : "border border-transparent hover:bg-(--bg-input)",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-sm font-semibold truncate",
                      active ? "text-(--accent)" : "text-(--text-primary)",
                    )}
                  >
                    {wsLabel}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteSession(s.workspaceId, s.channelName)
                    }}
                    title={t("chat.sessionList.delete")}
                    className={cn(
                      "h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
                      "text-(--text-tertiary) hover:enabled:text-(--danger-text)",
                    )}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                {s.lastMessagePreview && (
                  <div
                    className={cn(
                      "text-xs truncate mt-0.5",
                      active ? "text-(--text-secondary)" : "text-(--text-secondary)",
                    )}
                    title={s.lastMessagePreview}
                  >
                    {s.lastMessagePreview}
                  </div>
                )}
                <div className="text-2xs text-(--text-tertiary) mt-1">
                  {relativeTime(s.lastMessageAt, t)}
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
