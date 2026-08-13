import { describe, it, expect, beforeEach } from "vitest"

import { resetLocalPreferences } from "./local-data"
import { useAppearanceStore } from "@renderer/store/appearance"
import { useThemeStore } from "@renderer/store/theme"

describe("resetLocalPreferences", () => {
  beforeEach(() => localStorage.clear())

  it("clears every key the launcher writes for its own chrome", () => {
    localStorage.setItem("launcher:accent", "rose")
    localStorage.setItem("launcher:skin", "openagents")
    localStorage.setItem("launcher:theme-mode", "dark")
    localStorage.setItem("launcher:command-history", '["logs"]')
    localStorage.setItem("openagents:updateDismissals/v1", "{}")
    localStorage.setItem("oa.marketplace.prefs.v1", "{}")

    resetLocalPreferences()

    for (const key of [
      "launcher:accent",
      "launcher:skin",
      "launcher:theme-mode",
      "launcher:command-history",
      "openagents:updateDismissals/v1",
      "oa.marketplace.prefs.v1",
    ]) {
      expect(localStorage.getItem(key)).toBeNull()
    }
  })

  it("keeps the language, workspace favourites and onboarding progress", () => {
    localStorage.setItem("launcher:language", "zh")
    localStorage.setItem("workspace-prefs:v1", '{"favorites":["a"]}')
    localStorage.setItem("onboarding_completed", "true")
    localStorage.setItem("guided_tour_completed", "true")

    resetLocalPreferences()

    expect(localStorage.getItem("launcher:language")).toBe("zh")
    expect(localStorage.getItem("workspace-prefs:v1")).toBe('{"favorites":["a"]}')
    expect(localStorage.getItem("onboarding_completed")).toBe("true")
    expect(localStorage.getItem("guided_tour_completed")).toBe("true")
  })

  it("puts the live stores back to their defaults", () => {
    useAppearanceStore.getState().setAccent("rose")
    useAppearanceStore.getState().setScale("lg")
    useAppearanceStore.getState().setHighContrast(true)
    useThemeStore.getState().setMode("dark")

    resetLocalPreferences()

    const appearance = useAppearanceStore.getState()
    expect(appearance.accent).toBe("indigo")
    expect(appearance.scale).toBe("md")
    expect(appearance.highContrast).toBe(false)
    expect(useThemeStore.getState().mode).toBe("system")
  })
})
