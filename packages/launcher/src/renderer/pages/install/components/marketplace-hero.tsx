import React, { useMemo, useState } from "react"
import { ArrowUpRight, ChevronLeft, ChevronRight, Download } from "lucide-react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import type {
  AgentUpdateInfo,
  CatalogEntry,
  InstalledAgentRecord,
} from "@renderer/types"

import { describeEntry, platformsOf, runtimeOf } from "../entry-meta"
import { useHeroCarousel } from "../use-hero-carousel"

interface Props {
  catalog: CatalogEntry[]
  installed: InstalledAgentRecord[]
  updates: AgentUpdateInfo[]
  onOpen: (name: string) => void
}

const MAX_TAGS = 4
/** Long enough to feel like a rotation, short enough to stay scannable. */
const MAX_SLIDES = 5

/**
 * Rotating spotlight at the top of the marketplace. The banner exists to
 * introduce something, so it cycles through the agents the user does NOT have
 * — featured ones first. With nothing left to install it stops rotating and
 * settles on a featured agent instead.
 */
export function MarketplaceHero({
  catalog,
  installed,
  updates,
  onOpen,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  const slides = useMemo(() => pickSlides(catalog), [catalog])
  // Held still while the pointer or keyboard focus is on it: a slide should
  // not change under someone who is reading it or about to click it.
  const { index, select, prev, next } = useHeroCarousel(slides.length, hovered || focused)

  if (slides.length === 0) return null

  return (
    <section
      data-slot="hero"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      onKeyDown={(e) => {
        if (slides.length < 2) return
        if (e.key === "ArrowLeft") { e.preventDefault(); prev() }
        if (e.key === "ArrowRight") { e.preventDefault(); next() }
      }}
      // A plain card, like every other surface in the app. It was a tinted
      // panel with the arrows on either side of the slide, which left a wide
      // empty margin at its top-left and let a long slide run under an arrow.
      className="overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      {/* Every slide is laid into the same grid cell, so the banner is always
          as tall as its tallest slide; the others stay in place but invisible,
          hidden from screen readers and out of the tab order. `grid-cols-1` is
          `minmax(0, 1fr)`, which keeps a long title from widening the cell. */}
      <div className="grid grid-cols-1 p-6">
        {slides.map((slide, i) => (
          <HeroSlide
            key={slide.name}
            slide={slide}
            active={i === index}
            installed={installed}
            updates={updates}
            onOpen={onOpen}
          />
        ))}
      </div>

      {/* The controls on a footer of their own — they are the one thing that
          must not move when the slide does. */}
      {slides.length > 1 && (
        <div className="flex items-center justify-between border-t px-6 py-3">
          <div className="flex items-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide.name}
                type="button"
                aria-current={i === index}
                aria-label={slide.label || slide.name}
                title={slide.label || slide.name}
                onClick={() => select(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === index
                    ? "w-6 bg-primary"
                    : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label={t("install.hero.prev")} title={t("install.hero.prev")} onClick={prev}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label={t("install.hero.next")} title={t("install.hero.next")} onClick={next}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function HeroSlide({
  slide,
  active,
  installed,
  updates,
  onOpen,
}: {
  slide: CatalogEntry
  active: boolean
  installed: InstalledAgentRecord[]
  updates: AgentUpdateInfo[]
  onOpen: (name: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const current = installed.find((r) => r.name === slide.name)?.version
  const latest = updates.find((u) => u.name === slide.name)?.latest
  const tags = (slide.tags || []).slice(0, MAX_TAGS)

  const specs = [
    { key: "runtime", value: runtimeOf(slide) || t("install.hero.builtin") },
    { key: "platforms", value: platformsOf(slide).join(" · ") || "—" },
    { key: "binary", value: slide.install?.binary || slide.name },
  ]

  return (
    <div
      aria-hidden={!active}
      inert={!active}
      className={cn(
        "col-start-1 row-start-1 flex flex-col gap-6 lg:flex-row lg:items-center",
        // The enter animation plays whenever a slide becomes the current one:
        // the class is only present while it is.
        active
          ? "animate-in fade-in duration-300 ease-out motion-reduce:animate-none"
          : "invisible",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-6">
        {/* The mark on its own light tile, as the workspace's agent gallery
            draws it — legible on either theme. */}
        <AgentIcon type={slide.name} size={80} />

        <div className="flex min-w-0 flex-1 flex-col">
          <p className="m-0 text-xs text-muted-foreground">
            {t(slide.installed ? "install.hero.eyebrow" : "install.hero.eyebrowNew")}
          </p>
          <h2 className="m-0 mt-1 truncate text-2xl font-semibold tracking-tight">
            {slide.label || slide.name}
          </h2>
          {/* Two lines at most, so one long blurb cannot make every slide as
              tall as it is. */}
          <p className="m-0 mt-2 line-clamp-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {describeEntry(slide, t) || t("install.card.noDescription")}
          </p>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-3">
              {tags.map((tag) => (
                <Badge key={tag} variant="muted" size="sm" className="font-mono">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4">
            <Button onClick={() => onOpen(slide.name)}>
              {slide.installed ? <ArrowUpRight /> : <Download />}
              {t(slide.installed ? "install.hero.viewDetail" : "install.hero.installNow")}
            </Button>
            {(current || latest) && (
              <span className="font-mono text-xs text-muted-foreground">
                {current && t("install.hero.current", { version: current })}
                {current && latest && " · "}
                {latest && t("install.hero.latest", { version: latest })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* The facts, as label and value rows divided by hairlines — beside the
          slide on a wide window, under it on a narrow one. */}
      <dl className="m-0 shrink-0 divide-y border-t pt-1 lg:w-64 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        {specs.map((spec) => (
          <div key={spec.key} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-xs text-muted-foreground">{t(`install.hero.spec.${spec.key}`)}</dt>
            <dd className="m-0 min-w-0 truncate font-mono text-xs" title={spec.value}>{spec.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * What the banner rotates through: everything not installed yet, featured
 * first. Once the user has them all there is nothing left to introduce, so it
 * falls back to a single featured agent and stops moving.
 */
function pickSlides(catalog: CatalogEntry[]): CatalogEntry[] {
  const runnable = catalog.filter((c) => !c.comingSoon)
  const fresh = runnable
    .filter((c) => !c.installed)
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured))
  if (fresh.length > 0) return fresh.slice(0, MAX_SLIDES)

  const settled = runnable.find((c) => c.featured) || runnable[0]
  return settled ? [settled] : []
}
