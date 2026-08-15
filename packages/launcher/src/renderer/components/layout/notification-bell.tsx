import React from "react"
import { Bell } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover"
import { Button } from "@renderer/components/ui/button"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { useNotificationsStore } from "@renderer/store/notifications"
import {
  canRouteNotification,
  routeNotification,
} from "@renderer/hooks/useNotificationRouting"
import { cn } from "@renderer/lib/utils"
import type { NotifRecord } from "@renderer/types"

/** Beyond this the list is history nobody scrolls to; keeps the popover cheap. */
const MAX_VISIBLE = 30

export function NotificationBell({
  className,
}: {
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { items, unread, markRead, markAllRead, clear } = useNotificationsStore(
    useShallow((s) => ({
      items: s.items,
      unread: s.unread,
      markRead: s.markRead,
      markAllRead: s.markAllRead,
      clear: s.clear,
    })),
  )
  const [open, setOpen] = React.useState(false)

  // Routing lives in `useNotificationRouting`, not here. This list used to read
  // `payload.tab` and nothing else, which is a strict subset of what the
  // payloads carry: it sent "amp has an update" to the marketplace list instead
  // of to amp, and did nothing whatsoever for the launcher's own update, whose
  // payload names a Settings section rather than a tab.
  const openNotification = (record: NotifRecord): void => {
    if (!record.read) void markRead(record.id)
    if (routeNotification(record)) setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("nav.notifications.tooltip")}
          className={cn(
            "relative size-7 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            className,
          )}
        >
          <Bell className="size-3.5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-3xs font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      {/* The bell sits at the top of the rail, so the list opens downward and
          to the right of it rather than over the nav. */}
      <PopoverContent align="start" side="right" className="w-85 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="text-sm font-semibold">
            {t("nav.notifications.title")}
            {unread > 0 && (
              <span className="ml-1.5 text-2xs font-normal text-muted-foreground">
                {t("nav.notifications.unread", { count: unread })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-auto px-1.5 py-0.5 text-2xs" onClick={() => markAllRead()}>
                {t("nav.notifications.markAllRead")}
              </Button>
            )}
            {items.length > 0 && (
              <Button
                variant="destructive-ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-2xs"
                onClick={() => clear()}
              >
                {t("nav.notifications.clear")}
              </Button>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            {t("nav.notifications.empty")}
          </p>
        ) : (
          <ScrollArea className="max-h-115">
            <ul className="m-0 list-none p-0">
              {items.slice(0, MAX_VISIBLE).map((r) => {
                // Only the rows that lead somewhere look like they do. An
                // informational entry still marks itself read on click, it just
                // does not advertise a destination it does not have.
                const routable = canRouteNotification(r)
                return (
                  <li
                    key={r.id}
                    onClick={() => openNotification(r)}
                    className={cn(
                      "border-b px-3 py-2 last:border-b-0",
                      routable
                        ? "cursor-pointer hover:bg-accent"
                        : "cursor-default",
                      !r.read && "bg-accent/60",
                    )}
                  >
                    <div className="truncate text-xs font-medium">{r.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">
                      {r.body}
                    </div>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
