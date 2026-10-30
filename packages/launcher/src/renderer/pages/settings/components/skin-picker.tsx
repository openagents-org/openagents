import React from "react"
import { useTranslation } from "react-i18next"
import { CircleCheck } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { SKINS } from "../../../../shared/skins"
import { useAppearanceStore } from "@renderer/store/appearance"
import { useThemeStore } from "@renderer/store/theme"
import { cn } from "@renderer/lib/utils"
import { SkinPreview } from "./skin-preview"

/**
 * The skins, on the same three-column grid as the theme modes directly above.
 *
 * Sharing that grid is the whole point: the two rows of tiles line up, and a
 * skin tile is wide enough to carry its own description, which is what keeps
 * this from needing either a paragraph per row (a stacked list, which pushed
 * the accent and scale rows off the screen) or a separate caption line under
 * the grid (which left the width empty and the description homeless).
 *
 * Growth is bounded by scrolling the grid rather than the page: three per row
 * and a capped height means a twentieth skin costs nothing above it. Every
 * skin in the table renders, including the default one — making "no skin" a
 * visible, selectable option is what turns this from a toggle with extra steps
 * into a picker.
 */
export function SkinPicker(): React.JSX.Element {
  const { t } = useTranslation()
  const { skin, setSkin } = useAppearanceStore(
    useShallow((s) => ({ skin: s.skin, setSkin: s.setSkin })),
  )
  // The miniature shows each skin in the mode the app is actually in, so the
  // tiles differ by skin alone rather than by skin and theme at once.
  const theme = useThemeStore((s) => s.resolved)

  return (
    // The negative margin pairs with the padding: once the grid scrolls it
    // clips on both axes, and the padding is what gives the selected tile's
    // ring room to sit in.
    <div className="scrollbar-hide -m-1 grid max-h-96 grid-cols-3 gap-3 overflow-y-auto p-1">
      {SKINS.map((s) => {
        const active = skin === s.id
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setSkin(s.id)}
            aria-pressed={active}
            className={cn(
              "relative flex flex-col gap-2 rounded-lg border p-2 text-center transition-colors",
              active
                ? "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-muted-foreground/40",
            )}
          >
            {active && (
              <CircleCheck className="absolute top-3 right-3 size-4 fill-primary text-primary-foreground" />
            )}

            <SkinPreview skin={s} theme={theme} />

            <div className="min-w-0 px-1 pb-0.5">
              <div
                className={cn(
                  "truncate text-2xs text-foreground",
                  active ? "font-medium" : "font-normal",
                )}
                // The skin's own typeface, so the tile shows the type as well
                // as the colours. Its @font-face is loaded unconditionally, so
                // this resolves even while the skin is off.
                style={{ fontFamily: s.fontFamily ?? undefined }}
              >
                {t(`settings.appearance.skins.${s.id}.name`, {
                  defaultValue: s.id,
                })}
              </div>
              <div className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
                {t(`settings.appearance.skins.${s.id}.desc`, {
                  defaultValue: "",
                })}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
