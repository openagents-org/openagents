import { describe, it, expect } from "vitest"

import { asString, asPath, asName, asShellCommand } from "./ipc-input"

describe("IPC input checks", () => {
  it("accepts ordinary values unchanged", () => {
    expect(asString("hello", "field")).toBe("hello")
    expect(asPath("/Users/me/My Agents", "path")).toBe("/Users/me/My Agents")
    expect(asPath("C:\\Users\\王思璠\\agents", "path")).toBe(
      "C:\\Users\\王思璠\\agents",
    )
    // Names are free-form: spaces and non-Latin scripts are normal.
    expect(asName(" 我的助手 ", "agent name")).toBe("我的助手")
    expect(asShellCommand("claude auth login", "command")).toBe(
      "claude auth login",
    )
  })

  it("rejects wrong types instead of coercing them", () => {
    expect(() => asString(42, "field")).toThrow(/expected a string/)
    expect(() => asPath(null, "path")).toThrow(/expected a string/)
    expect(() => asPath(undefined, "path")).toThrow(/expected a string/)
    expect(() => asName({}, "agent name")).toThrow(/expected a string/)
  })

  it("rejects empty values", () => {
    expect(() => asPath("   ", "path")).toThrow(/must not be empty/)
    expect(() => asName("", "agent name")).toThrow(/must not be empty/)
  })

  it("rejects a NUL, which would truncate the path libuv actually opens", () => {
    expect(() => asPath("/tmp/safe\u0000/../../etc", "path")).toThrow(
      /control characters/,
    )
  })

  it("rejects a newline in a terminal command, which would be a second command", () => {
    expect(() =>
      asShellCommand("cursor-agent login\nrm -rf ~", "command"),
    ).toThrow(/control characters/)
    expect(() => asShellCommand("a\r\nb", "command")).toThrow(
      /control characters/,
    )
  })

  it("caps absurd lengths", () => {
    expect(() => asName("x".repeat(300), "agent name")).toThrow(/longer than/)
    expect(() => asShellCommand("x".repeat(5000), "command")).toThrow(
      /longer than/,
    )
  })

  it("names the offending field so the error is actionable", () => {
    expect(() => asPath(7, "working directory")).toThrow(
      /Invalid working directory/,
    )
  })
})
