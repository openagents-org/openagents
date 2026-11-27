import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Select, SelectTrigger, SelectValue, type SelectSize } from "./select"

// A SelectTrigger given its own height has to keep it. The shadcn component
// ships the default height as `data-[size=default]:h-8`, whose attribute
// selector outranks a caller's `h-10`, so the trigger sat short of the button
// beside it. Regenerating the component brings that back; this keeps it out.
function trigger(props: { className?: string; size?: SelectSize }) {
  render(
    <Select>
      <SelectTrigger aria-label="pick" {...props}>
        <SelectValue />
      </SelectTrigger>
    </Select>
  )
  return [...screen.getByRole("combobox", { name: "pick" }).classList]
}

describe("SelectTrigger height", () => {
  it.each(["default", "sm", "xs"] as const)("sets no height behind a data-size selector (%s)", (size) => {
    expect(trigger({ size }).filter((c) => /^data-\[size=[^\]]+\]:(h|min-h|size)-/.test(c))).toEqual([])
  })

  it.each([
    ["default", "h-8"],
    ["sm", "h-7"],
    ["xs", "h-6"],
  ] as const)("size %s defaults to %s", (size, height) => {
    expect(trigger({ size })).toContain(height)
  })

  it("lets a caller's height replace the default", () => {
    const classes = trigger({ className: "h-10 w-full" })
    expect(classes).toContain("h-10")
    expect(classes).not.toContain("h-8")
  })
})
