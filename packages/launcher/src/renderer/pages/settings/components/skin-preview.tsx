import React from "react"

import type { SkinDefinition } from "../../../../shared/skins"
import type { ResolvedTheme } from "@renderer/store/theme"

/**
 * Miniature of the app window wearing one skin: rail on the left, header and
 * content blocks on the right — the same shape ThemePreview draws.
 *
 * Every colour and every frame value comes from the skin's own entry in
 * shared/skins.ts rather than from a design token, for the reason that makes
 * this component possible at all: each tile has to show a skin the app is not
 * currently wearing, which is exactly what tokens cannot do. That is also what
 * keeps it from ever needing a branch per skin — a new entry in the table
 * draws itself.
 */
export function SkinPreview({
  skin,
  theme,
}: {
  skin: SkinDefinition
  theme: ResolvedTheme
}): React.JSX.Element {
  const c = skin.chrome[theme]
  const { radius, borderWidth } = skin.frame

  return (
    <div
      // Same height as ThemePreview, and full width of whatever tile it is
      // dropped into: the skin grid and the theme grid sit one above the other,
      // and thumbnails that do not match read as two unrelated controls.
      className="h-16 w-full overflow-hidden"
      style={{
        backgroundColor: c.bg,
        border: `${borderWidth}px solid ${c.border}`,
        borderRadius: radius,
        // Offset block, no blur — the single value that tells a hard-shadow
        // skin apart from a soft one at this size. Half the skin's own offset:
        // the miniature is about a quarter scale.
        boxShadow: c.shadow ? `2px 2px 0 0 ${c.shadow}` : undefined,
      }}
    >
      <div className="flex h-full w-full">
        <div
          className="h-full w-1/4 shrink-0 p-1"
          style={{ backgroundColor: c.rail }}
        >
          <div
            className="mb-1 h-1 w-full rounded-full"
            style={{ backgroundColor: c.msg }}
          />
          <div
            className="mb-1 h-1 w-3/4 rounded-full"
            style={{ backgroundColor: c.detail }}
          />
          <div
            className="h-1 w-3/4 rounded-full"
            style={{ backgroundColor: c.detail }}
          />
        </div>

        <div className="min-w-0 flex-1 p-1.5">
          <div
            className="mb-1.5 h-1.5 w-1/2 rounded-full"
            style={{ backgroundColor: c.title }}
          />
          {/* Cards, not filler: they carry the skin's frame, which is where
              its border weight and radius actually show up. */}
          <Card chrome={c} frame={skin.frame} />
          <Card chrome={c} frame={skin.frame} last />
        </div>
      </div>
    </div>
  )
}

function Card({
  chrome,
  frame,
  last,
}: {
  chrome: SkinDefinition["chrome"]["light"]
  frame: SkinDefinition["frame"]
  last?: boolean
}): React.JSX.Element {
  return (
    <div
      className={last ? "h-4 w-full" : "mb-1 h-4 w-full"}
      style={{
        backgroundColor: chrome.panel,
        border: `${frame.borderWidth}px solid ${chrome.border}`,
        borderRadius: Math.max(2, frame.radius / 2),
      }}
    />
  )
}
