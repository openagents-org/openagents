import { describe, it, expect, beforeEach } from "vitest"

import { useUiStore } from "@renderer/store/ui"
import type { NotifRecord } from "@renderer/types"

import { canRouteNotification, routeNotification } from "./useNotificationRouting"

function notif(over: Partial<NotifRecord> = {}): NotifRecord {
  return {
    id: "n1",
    createdAt: "2026-08-06T00:00:00.000Z",
    read: false,
    kind: "update_available",
    title: "t",
    body: "b",
    ...over,
  }
}

/** Whatever the previous case navigated to must not leak into the next one. */
beforeEach(() => {
  useUiStore.setState({
    currentTab: "dashboard",
    installFocusAgent: null,
    installListSignal: 0,
    settingsSection: null,
    settingsSectionSignal: 0,
    updateBannerDismissed: "downloaded:1.0.0",
  })
})

describe("routeNotification", () => {
  // The reported bug: clicking "amp has an update" landed on the marketplace
  // list with amp nowhere in sight, and did nothing at all when the user was
  // already on an agent's detail page.
  it("opens the named agent's detail page", () => {
    expect(
      routeNotification(notif({ payload: { tab: "install", agent: "amp" } })),
    ).toBe(true)
    expect(useUiStore.getState().currentTab).toBe("install")
    expect(useUiStore.getState().installFocusAgent).toBe("amp")
  })

  // Setting the tab it is already on is a no-op in the store, so the focus
  // request is the only thing that can move an open detail page.
  it("still moves when the Install tab is already open", () => {
    useUiStore.setState({ currentTab: "install" })
    routeNotification(notif({ payload: { tab: "install", agent: "goose" } }))
    expect(useUiStore.getState().installFocusAgent).toBe("goose")
  })

  // Several agents have no single destination — and a plain setCurrentTab
  // would leave whatever detail page is open sitting there.
  it("returns to the marketplace list when no agent is named", () => {
    useUiStore.setState({ currentTab: "install" })
    expect(routeNotification(notif({ payload: { tab: "install" } }))).toBe(true)
    expect(useUiStore.getState().installListSignal).toBe(1)
  })

  it("opens a Settings section", () => {
    expect(
      routeNotification(notif({ payload: { settingsSection: "updates" } })),
    ).toBe(true)
    expect(useUiStore.getState().currentTab).toBe("settings")
    expect(useUiStore.getState().settingsSection).toBe("updates")
  })

  // The banner is unmounted once dismissed, so the click has to bring it back
  // before navigating or the user lands somewhere with no way to install.
  it("restores a dismissed update banner for launcher updates", () => {
    routeNotification(
      notif({ source: "launcher-update", payload: { settingsSection: "updates" } }),
    )
    expect(useUiStore.getState().updateBannerDismissed).toBeNull()
  })

  it("routes a plain tab", () => {
    expect(routeNotification(notif({ payload: { tab: "logs" } }))).toBe(true)
    expect(useUiStore.getState().currentTab).toBe("logs")
  })

  it("reports going nowhere for an informational entry", () => {
    expect(routeNotification(notif({ kind: "system" }))).toBe(false)
    expect(useUiStore.getState().currentTab).toBe("dashboard")
  })
})

describe("canRouteNotification", () => {
  it("agrees with routeNotification about what leads somewhere", () => {
    const cases: Array<[NotifRecord, boolean]> = [
      [notif({ payload: { tab: "install", agent: "amp" } }), true],
      [notif({ payload: { tab: "install" } }), true],
      [notif({ payload: { settingsSection: "updates" } }), true],
      [notif({ source: "launcher-update" }), true],
      [notif({ kind: "system" }), false],
      [notif({ payload: {} }), false],
    ]
    for (const [record, expected] of cases) {
      expect(canRouteNotification(record)).toBe(expected)
    }
  })
})
