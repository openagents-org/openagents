import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { initUnpromptedFocusGuard } from "./unprompted-focus"

function add<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement = document.body): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  parent.appendChild(el)
  return el
}

/** Stopped after each case: listeners left on window outlive the test. */
let stop: () => void = () => {}

beforeEach(() => {
  document.body.innerHTML = ""
  stop = initUnpromptedFocusGuard()
})

afterEach(() => {
  stop()
  ;(document.activeElement as HTMLElement | null)?.blur()
})

describe("initUnpromptedFocusGuard", () => {
  it("releases focus that lands on a control before any input", () => {
    const button = add("button")
    button.focus()
    expect(document.activeElement).toBe(document.body)
    // The throwaway element used to reset the Tab starting point is gone.
    expect(document.body.children).toHaveLength(1)
  })

  it("keeps focus that follows a key press", () => {
    const button = add("button")
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    button.focus()
    expect(document.activeElement).toBe(button)
  })

  it("keeps focus that follows a pointer press", () => {
    const button = add("button")
    window.dispatchEvent(new Event("pointerdown"))
    button.focus()
    expect(document.activeElement).toBe(button)
  })

  it("leaves text fields and dialogs to place their own focus", () => {
    const input = add("input")
    input.focus()
    expect(document.activeElement).toBe(input)

    const dialog = add("div")
    dialog.setAttribute("role", "dialog")
    const inDialog = add("button", dialog)
    inDialog.focus()
    expect(document.activeElement).toBe(inDialog)
  })

  it("releases traversal to another element once the window has lost focus", () => {
    // The workspace-view case: an element is still focused in the page, and
    // returning focus traverses to a different one — with the first as its
    // related target, which is why that cannot be used to let it through.
    const first = add("button")
    const second = add("button")
    window.dispatchEvent(new Event("pointerdown"))
    first.focus()
    window.dispatchEvent(new FocusEvent("blur"))
    second.focus()
    expect(document.activeElement).toBe(document.body)
  })

  it("keeps the element that held focus when the window lost it", () => {
    const button = add("button")
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    button.focus()
    window.dispatchEvent(new FocusEvent("blur"))
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    expect(document.activeElement).toBe(button)
  })
})
