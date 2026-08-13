import { describe, it, expect } from "vitest"

import { SUPPORTED_LANGUAGES, resources } from "./index"

/**
 * i18next nesting (`$t(other.key)`) fails silently: a mistyped reference does
 * not throw and does not leave the `$t(…)` marker behind either — i18next
 * substitutes the missing key's own name, so the UI ends up telling the user to
 * click "common.workspaceMenu.nodes".
 *
 * The workspace's own menu names are shared this way — one term, translated
 * once, quoted by every string that tells the user where to click — so a typo
 * would ship an unreadable instruction in exactly the copy that exists to be
 * followed. Hence checking the references themselves rather than the render.
 */
const NESTED = /\$t\(([^)]+)\)/g

function walk(
  node: unknown,
  path: string[] = [],
): Array<{ key: string; value: string }> {
  if (typeof node === "string") return [{ key: path.join("."), value: node }]
  if (!node || typeof node !== "object") return []
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    walk(v, [...path, k]),
  )
}

function lookup(bundle: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      bundle,
    )
}

describe("i18n nesting", () => {
  for (const { value: lng } of SUPPORTED_LANGUAGES) {
    it(`points every $t() reference at a real string in ${lng}`, () => {
      const bundle = resources[lng].translation
      const broken: string[] = []

      for (const { key, value } of walk(bundle)) {
        for (const [, ref] of value.matchAll(NESTED)) {
          // `$t(key, {opts})` is legal; only the key half is a reference.
          const target = ref.split(",")[0].trim()
          if (typeof lookup(bundle, target) !== "string") {
            broken.push(`${key} → ${target}`)
          }
        }
      }

      expect(broken).toEqual([])
    })
  }

  it("keeps a shared term in step with both languages", () => {
    // The point of sharing these: the launcher quotes the workspace's menu, so
    // each language has to quote it in that language.
    const en = lookup(resources.en.translation, "common.workspaceMenu.nodes")
    const zh = lookup(resources.zh.translation, "common.workspaceMenu.nodes")
    expect(en).toBe("Nodes")
    expect(zh).not.toBe(en)
  })
})
