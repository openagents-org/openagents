import { describe, it, expect } from "vitest"

import { toLauncherLanguage, toWorkspaceLocale } from "./appearance-bridge"

describe("toWorkspaceLocale", () => {
  it("maps the launcher's languages", () => {
    expect(toWorkspaceLocale("zh")).toBe("zh-CN")
    expect(toWorkspaceLocale("en")).toBe("en-US")
  })

  it("keeps Chinese when the language arrives region-tagged", () => {
    // <html lang> after the shared workspace I18nProvider has rendered.
    expect(toWorkspaceLocale("zh-CN")).toBe("zh-CN")
    expect(toWorkspaceLocale("en-US")).toBe("en-US")
  })

  it("falls back to English for anything else", () => {
    expect(toWorkspaceLocale("")).toBe("en-US")
    expect(toWorkspaceLocale("fr")).toBe("en-US")
  })

  it("round-trips with toLauncherLanguage", () => {
    expect(toLauncherLanguage(toWorkspaceLocale("zh"))).toBe("zh")
    expect(toLauncherLanguage(toWorkspaceLocale("en"))).toBe("en")
  })
})
