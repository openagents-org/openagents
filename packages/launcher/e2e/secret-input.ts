import type { Locator } from "@playwright/test"

// Types a secret (API key, private gateway URL) into an input WITHOUT it
// landing in the Playwright trace. `locator.fill(value)` records the value in
// the step title and params, and failed runs upload their trace as a public
// artifact, so a fill() of a real key publishes it. evaluate() arguments are
// recorded only as an opaque "Object", so the value goes in that way.
//
// The input is React-controlled: assigning `.value` directly is overwritten on
// the next render, so this calls the native setter and fires `input`, the way
// a real keystroke reaches React's onChange.
export async function fillSecret(input: Locator, value: string): Promise<void> {
  await input.waitFor({ state: "visible" })
  const ok = await input.evaluate(
    (el, { v }) => {
      const field = el as HTMLInputElement
      field.focus()
      const proto = Object.getPrototypeOf(field) as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      if (setter) setter.call(field, v)
      else field.value = v
      field.dispatchEvent(new Event("input", { bubbles: true }))
      field.dispatchEvent(new Event("change", { bubbles: true }))
      return field.value === v
    },
    { v: value },
  )
  // Never echo the value: only that it did not stick.
  if (!ok) throw new Error("fillSecret: the input did not keep the value")
}
