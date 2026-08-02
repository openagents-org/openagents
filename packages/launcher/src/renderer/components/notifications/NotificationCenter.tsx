import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Bell,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  AtSign,
  Github,
  AlertOctagon,
  X,
  Settings as SettingsIcon,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { useNotificationsStore } from "../../store/notifications"
import { useUiStore } from "../../store/ui"
import { Button } from "../ui/button"
import { Switch } from "../ui/switch"
import type { NotifKind, NotifRecord } from "../../types"
import { cn } from "../../lib/utils"

// Order/keys for the per-kind mute list; labels are translated at render time
// via `t("notificationsPanel.kinds.<kind>")`.
const NOTIF_KINDS: NotifKind[] = [
  "agent_error",
  "agent_finished",
  "agent_mention",
  "agent_waiting_input",
  "workspace_mention",
  "workspace_message",
  "workspace_error",
  "platform_error",
  "github",
  "system",
]

function kindIcon(kind: NotifKind): React.JSX.Element {
  switch (kind) {
    case "agent_error":
    case "workspace_error":
    case "platform_error":
      return <AlertOctagon className="w-3.5 h-3.5 text-(--danger-text)" />
    case "agent_finished":
      return <CheckCircle2 className="w-3.5 h-3.5 text-(--success-text)" />
    case "agent_mention":
    case "workspace_mention":
      return <AtSign className="w-3.5 h-3.5 text-(--accent)" />
    case "workspace_message":
      return <MessageSquare className="w-3.5 h-3.5 text-(--text-secondary)" />
    case "github":
      return <Github className="w-3.5 h-3.5" />
    default:
      return <Bell className="w-3.5 h-3.5 text-(--text-secondary)" />
  }
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function NotificationCenterButton(): React.JSX.Element {
  const { t } = useTranslation()
  const { items, unread, markRead, markAllRead, clear, prefs, setPrefs } =
    useNotificationsStore(
      useShallow((s) => ({
        items: s.items,
        unread: s.unread,
        markRead: s.markRead,
        markAllRead: s.markAllRead,
        clear: s.clear,
        prefs: s.prefs,
        setPrefs: s.setPrefs,
      })),
    )
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const [open, setOpen] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const visible = useMemo(() => {
    if (filter === "unread") return items.filter((i) => !i.read)
    return items
  }, [items, filter])

  const handleClick = (r: NotifRecord): void => {
    if (!r.read) void markRead(r.id)
    if (r.payload && typeof r.payload.tab === "string") {
      setCurrentTab(r.payload.tab as string)
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        title={t("notificationsPanel.tooltip")}
        aria-label={t("notificationsPanel.ariaLabel", { count: unread })}
        className="relative h-8 w-8 text-(--text-secondary) hover:enabled:text-(--text-primary)"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-(--danger) text-white text-3xs font-bold leading-4 text-center pointer-events-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50",
            "w-90 max-h-130",
            "bg-(--bg-card) border border-(--border) rounded-(--radius)",
            "shadow-(--shadow-lg) overflow-hidden flex flex-col",
          )}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-(--border)">
            <div className="text-sm font-semibold text-(--text-primary)">
              {t("notificationsPanel.title")}
              {unread > 0 && (
                <span className="ml-1.5 text-2xs text-(--text-tertiary) font-normal">
                  {t("notificationsPanel.unread", { count: unread })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPrefs((s) => !s)}
                title={t("notificationsPanel.settingsTooltip")}
                className="h-6 w-6 text-(--text-secondary) hover:enabled:text-(--text-primary)"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
              </Button>
              {!showPrefs && items.length > 0 && (
                <Button variant="link" size="sm" onClick={() => clear()}>
                  {t("notificationsPanel.clear")}
                </Button>
              )}
            </div>
          </div>

          {showPrefs && prefs ? (
            <div className="flex-1 overflow-y-auto px-3.5 py-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-medium text-(--text-primary)">
                    {t("notificationsPanel.prefs.enable")}
                  </div>
                  <div className="text-2xs text-(--text-tertiary)">
                    {t("notificationsPanel.prefs.enableDesc")}
                  </div>
                </div>
                <Switch
                  checked={prefs.enabled}
                  onCheckedChange={(v) => setPrefs({ enabled: v })}
                />
              </div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-medium text-(--text-primary)">
                    {t("notificationsPanel.prefs.playSound")}
                  </div>
                </div>
                <Switch
                  checked={prefs.soundEnabled}
                  onCheckedChange={(v) => setPrefs({ soundEnabled: v })}
                />
              </div>
              <div className="mt-4">
                <div className="text-2xs uppercase tracking-wide text-(--text-tertiary) mb-2">
                  {t("notificationsPanel.prefs.muteByKind")}
                </div>
                <div className="flex flex-col gap-1.5">
                  {NOTIF_KINDS.map((k) => {
                    const muted = prefs.mutedKinds.includes(k)
                    return (
                      <label
                        key={k}
                        className="flex items-center justify-between text-xs py-1 cursor-pointer"
                      >
                        <span>{t(`notificationsPanel.kinds.${k}`)}</span>
                        <Switch
                          checked={!muted}
                          onCheckedChange={(v) => {
                            const next = new Set(prefs.mutedKinds)
                            if (v) next.delete(k)
                            else next.add(k)
                            void setPrefs({ mutedKinds: Array.from(next) })
                          }}
                        />
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="mt-4">
                <div className="text-2xs uppercase tracking-wide text-(--text-tertiary) mb-2">
                  {t("notificationsPanel.prefs.quietHours")}
                </div>
                <QuietHoursControl
                  value={prefs.quietHours}
                  onChange={(v) => setPrefs({ quietHours: v })}
                />
              </div>
              <Button variant="outline"
                size="sm"
                className="mt-4 w-full"
                onClick={() => setShowPrefs(false)}
              >
                {t("notificationsPanel.prefs.done")}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-(--border)">
                <div className="flex gap-1">
                  {(["all", "unread"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={cn(
                        "px-2 py-0.5 text-2xs rounded-sm border-0 cursor-pointer",
                        filter === f
                          ? "bg-(--bg-input) text-(--text-primary) font-medium"
                          : "bg-transparent text-(--text-secondary)",
                      )}
                    >
                      {f === "all" ? t("notificationsPanel.filters.all") : t("notificationsPanel.filters.unread")}
                    </button>
                  ))}
                </div>
                {unread > 0 && (
                  <Button variant="link" size="sm" onClick={() => markAllRead()}>
                    {t("notificationsPanel.markAllRead")}
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {visible.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-(--text-tertiary)">
                    {filter === "unread"
                      ? t("notificationsPanel.empty.unread")
                      : t("notificationsPanel.empty.all")}
                  </div>
                ) : (
                  <ul className="m-0 p-0 list-none">
                    {visible.map((r) => (
                      <li
                        key={r.id}
                        onClick={() => handleClick(r)}
                        className={cn(
                          "flex items-start gap-2.5 px-3.5 py-2.5 border-b border-(--border) cursor-pointer transition-colors duration-100",
                          !r.read && "bg-(--accent-bg)",
                          "hover:bg-(--bg-input)",
                        )}
                      >
                        <div className="shrink-0 mt-0.5">
                          {kindIcon(r.kind)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div
                              className={cn(
                                "text-xs truncate",
                                r.read
                                  ? "text-(--text-primary) font-normal"
                                  : "text-(--text-primary) font-semibold",
                              )}
                            >
                              {r.title}
                            </div>
                            <span className="text-3xs text-(--text-tertiary) shrink-0">
                              {timeAgo(r.createdAt)}
                            </span>
                          </div>
                          <div className="text-2xs text-(--text-secondary) line-clamp-2 mt-0.5">
                            {r.body}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            void clear(r.id)
                          }}
                          title={t("notificationsPanel.dismiss")}
                          className="h-5 w-5 shrink-0 opacity-50 hover:opacity-100 text-(--text-secondary)"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function QuietHoursControl({
  value,
  onChange,
}: {
  value: [number, number] | null
  onChange: (v: [number, number] | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const enabled = !!value
  const [start, end] = value || [22, 7]
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs">{t("notificationsPanel.prefs.quietHoursLabel")}</span>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onChange(v ? [22, 7] : null)}
        />
      </div>
      {enabled && (
        <div className="flex items-center gap-2 text-2xs text-(--text-secondary)">
          <select
            value={start}
            onChange={(e) => onChange([Number(e.target.value), end])}
            className="bg-(--bg-input) border border-(--border) rounded-sm px-2 py-1 text-2xs"
          >
            {Array.from({ length: 24 }).map((_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <span>→</span>
          <select
            value={end}
            onChange={(e) => onChange([start, Number(e.target.value)])}
            className="bg-(--bg-input) border border-(--border) rounded-sm px-2 py-1 text-2xs"
          >
            {Array.from({ length: 24 }).map((_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
