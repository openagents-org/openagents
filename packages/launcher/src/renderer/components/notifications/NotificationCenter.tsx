import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Bell,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  AtSign,
  Github,
  AlertOctagon,
  Download,
  X,
  Settings as SettingsIcon,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { useNotificationsStore } from "../../store/notifications"
import { routeNotification } from "../../hooks/useNotificationRouting"
import { Button } from "../ui/button"
import {
  SelectGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
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
  "update_available",
  "system",
]

function kindIcon(kind: NotifKind): React.JSX.Element {
  switch (kind) {
    case "agent_error":
    case "workspace_error":
    case "platform_error":
      return <AlertOctagon className="w-3.5 h-3.5 text-destructive" />
    case "agent_finished":
      return <CheckCircle2 className="w-3.5 h-3.5 text-success-foreground" />
    case "agent_mention":
    case "workspace_mention":
      return <AtSign className="w-3.5 h-3.5 text-primary" />
    case "workspace_message":
      return <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
    case "github":
      return <Github className="w-3.5 h-3.5" />
    case "update_available":
      return <Download className="w-3.5 h-3.5 text-warning" />
    default:
      return <Bell className="w-3.5 h-3.5 text-muted-foreground" />
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

  // Same routing as an OS toast click — see hooks/useNotificationRouting.
  const handleClick = (r: NotifRecord): void => {
    if (!r.read) void markRead(r.id)
    if (routeNotification(r)) setOpen(false)
  }

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        title={t("notificationsPanel.tooltip")}
        aria-label={t("notificationsPanel.ariaLabel", { count: unread })}
        className="relative h-8 w-8 text-muted-foreground hover:enabled:text-foreground"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-xs font-bold leading-4 text-center pointer-events-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50",
            "w-90 max-h-130",
            "bg-card border border-border rounded-lg",
            "shadow-lg overflow-hidden flex flex-col",
          )}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
            <div className="text-sm font-semibold text-foreground">
              {t("notificationsPanel.title")}
              {unread > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
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
                className="h-6 w-6 text-muted-foreground hover:enabled:text-foreground"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
              </Button>
              {!showPrefs && items.length > 0 && (
                <Button variant="destructive" size="sm" onClick={() => clear()}>
                  {t("notificationsPanel.clear")}
                </Button>
              )}
            </div>
          </div>

          {showPrefs && prefs ? (
            <div className="flex-1 overflow-y-auto px-3.5 py-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-medium text-foreground">
                    {t("notificationsPanel.prefs.enable")}
                  </div>
                  <div className="text-xs text-muted-foreground">
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
                  <div className="text-xs font-medium text-foreground">
                    {t("notificationsPanel.prefs.playSound")}
                  </div>
                </div>
                <Switch
                  checked={prefs.soundEnabled}
                  onCheckedChange={(v) => setPrefs({ soundEnabled: v })}
                />
              </div>
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
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
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
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
              <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-border">
                <div className="flex gap-1">
                  {(["all", "unread"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={cn(
                        "px-2 py-0.5 text-xs rounded-sm border-0",
                        filter === f
                          ? "bg-muted text-foreground font-medium"
                          : "bg-transparent text-muted-foreground",
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
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
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
                          "flex items-start gap-2.5 px-3.5 py-2.5 border-b border-border cursor-pointer transition-colors duration-100",
                          !r.read && "bg-primary/5",
                          "hover:bg-muted",
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
                                  ? "text-foreground font-normal"
                                  : "text-foreground font-semibold",
                              )}
                            >
                              {r.title}
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {timeAgo(r.createdAt)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
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
                          className="h-5 w-5 shrink-0 opacity-50 hover:opacity-100 text-muted-foreground"
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

const HOURS = Array.from({ length: 24 }, (_, h) => h)

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`
}

function HourSelect({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (hour: number) => void
  label: string
}): React.JSX.Element {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="xs" className="w-20" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent size="xs">
        <SelectGroup>
          {HOURS.map((hour) => (
            <SelectItem key={hour} value={String(hour)}>
              {formatHour(hour)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <HourSelect
            value={start}
            onChange={(hour) => onChange([hour, end])}
            label={t("notificationsPanel.prefs.quietHoursStart")}
          />
          <span>→</span>
          <HourSelect
            value={end}
            onChange={(hour) => onChange([start, hour])}
            label={t("notificationsPanel.prefs.quietHoursEnd")}
          />
        </div>
      )}
    </div>
  )
}
