import { describe, it, expect, beforeEach, vi } from "vitest"

// app-menu.ts only touches electron inside installApplicationMenu(), so the
// mock records what that function hands the menu system.
//
// vi.hoisted: the mock factory is lifted above these declarations, so plain
// consts would still be in their temporal dead zone when it runs.
const { setApplicationMenu, buildFromTemplate } = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
}))

vi.mock("electron", () => ({
  app: { isPackaged: true },
  Menu: { setApplicationMenu, buildFromTemplate },
}))

import { installApplicationMenu, isReloadShortcut } from "./app-menu"

type Input = Parameters<typeof isReloadShortcut>[0]

const key = (over: Partial<Input>): Input => ({
  type: "keyDown",
  key: "r",
  control: false,
  meta: false,
  ...over,
})

describe("isReloadShortcut", () => {
  it("catches Cmd+R and Cmd+Shift+R on macOS", () => {
    expect(isReloadShortcut(key({ meta: true }), "darwin")).toBe(true)
    // Shift is deliberately not inspected — force-reload is the same verb.
    expect(isReloadShortcut(key({ meta: true, key: "R" }), "darwin")).toBe(true)
  })

  it("catches Ctrl+R off macOS", () => {
    expect(isReloadShortcut(key({ control: true }), "win32")).toBe(true)
    expect(isReloadShortcut(key({ control: true }), "linux")).toBe(true)
  })

  it("catches F5 everywhere", () => {
    expect(isReloadShortcut(key({ key: "F5" }), "darwin")).toBe(true)
    expect(isReloadShortcut(key({ key: "F5" }), "win32")).toBe(true)
  })

  it("leaves the other platform's modifier alone", () => {
    // Ctrl+R on macOS is a text-field binding, not a reload.
    expect(isReloadShortcut(key({ control: true }), "darwin")).toBe(false)
    expect(isReloadShortcut(key({ meta: true }), "win32")).toBe(false)
  })

  it("ignores plain R and key-up events", () => {
    expect(isReloadShortcut(key({}), "darwin")).toBe(false)
    expect(isReloadShortcut(key({ meta: true, type: "keyUp" }), "darwin")).toBe(
      false,
    )
  })
})

/**
 * The menu is what binds Ctrl/Cmd+C, +V and +X. Setting it to `null` to take
 * away Ctrl+R took the clipboard with it, and no text field in the app could
 * paste — so "no menu at all" must not come back.
 */
describe("installApplicationMenu", () => {
  beforeEach(() => {
    setApplicationMenu.mockClear()
    buildFromTemplate.mockClear()
  })

  it("always installs a menu carrying the editing roles", () => {
    installApplicationMenu()

    expect(setApplicationMenu).toHaveBeenCalledTimes(1)
    expect(setApplicationMenu.mock.calls[0][0]).not.toBeNull()

    const template = buildFromTemplate.mock.calls[0][0] as Array<{
      role?: string
    }>
    expect(template.some((item) => item.role === "editMenu")).toBe(true)
  })

  it("installs no reload item of its own", () => {
    installApplicationMenu()

    const roles = JSON.stringify(buildFromTemplate.mock.calls[0][0])
    expect(roles).not.toMatch(/reload/i)
  })
})
