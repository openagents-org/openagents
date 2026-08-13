import { describe, it, expect, vi } from "vitest"

// app-menu.ts only touches electron inside installApplicationMenu(); the shape
// here just has to satisfy the module-level import under vitest.
vi.mock("electron", () => ({
  app: { isPackaged: true },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
}))

import { isReloadShortcut } from "./app-menu"

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
