import { useEffect } from "react"

import { useNotificationsStore } from "@renderer/store/notifications"
import { useUiStore } from "@renderer/store/ui"
import type { NotifRecord } from "@renderer/types"

/**
 * What clicking a notification does — shared by the OS toast and the entries
 * in the notification centre, so the two can never disagree about where a
 * given notification leads.
 *
 * Routing is driven by `payload`, which the main process sets when it pushes:
 * `tab` for a plain page, `settingsSection` for a Settings sub-page.
 *
 * Returns whether the click led anywhere, so callers can close a popover only
 * when something actually happened.
 */
/**
 * Whether clicking this notification would go anywhere — the same question
 * routeNotification answers, minus the navigating. Surfaces that decorate a
 * row as clickable have to know before the click, and asking here keeps that
 * decision from drifting away from the routing itself.
 */
export function canRouteNotification(record: NotifRecord): boolean {
  const payload = (record.payload ?? {}) as {
    tab?: unknown
    settingsSection?: unknown
  }
  return (
    record.source === "launcher-update" ||
    typeof payload.settingsSection === "string" ||
    typeof payload.tab === "string"
  )
}

export function routeNotification(record: NotifRecord): boolean {
  const payload = (record.payload ?? {}) as {
    tab?: unknown
    settingsSection?: unknown
  }
  const ui = useUiStore.getState()
  let acted = false

  // A dismissed update banner is unmounted, so re-showing it has to happen
  // before navigation — otherwise clicking the "update ready" toast lands the
  // user on a page with no visible way to install.
  if (record.source === "launcher-update") {
    ui.showUpdateBanner()
    acted = true
  }

  if (typeof payload.settingsSection === "string") {
    ui.openSettingsSection(payload.settingsSection)
    return true
  }
  if (typeof payload.tab === "string") {
    ui.setCurrentTab(payload.tab)
    return true
  }
  return acted
}

/**
 * Handles clicks on the OS-level toast. Main focuses the window and forwards
 * the record; without this subscription the click did nothing beyond raising
 * the window, whatever the notification said.
 */
export function useNotificationClicks(): void {
  useEffect(() => {
    return window.api.onNotificationClicked((record) => {
      if (!record.read) void useNotificationsStore.getState().markRead(record.id)
      routeNotification(record)
    })
  }, [])
}
