import React from "react"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CommandText } from "./command-text"

describe("CommandText", () => {
  it("keeps each argument whole and the copied text unchanged", () => {
    const { container } = render(<code><CommandText command="npm install -g @anthropic-ai/claude-code" /></code>)
    expect(container.textContent).toBe("npm install -g @anthropic-ai/claude-code")
    const nowrap = [...container.querySelectorAll("span.whitespace-nowrap")].map((s) => s.textContent)
    expect(nowrap).toEqual(["npm", "install", "-g", "@anthropic-ai/claude-code"])
  })

  it("lets an argument too long for a line break inside itself", () => {
    const path = "/Users/someone/.nvm/versions/node/v24.20.0/lib/node_modules"
    const { container } = render(<code><CommandText command={`npm i --prefix ${path}`} /></code>)
    const nowrap = [...container.querySelectorAll("span.whitespace-nowrap")].map((s) => s.textContent)
    expect(nowrap).not.toContain(path)
    expect(container.textContent).toBe(`npm i --prefix ${path}`)
  })
})
