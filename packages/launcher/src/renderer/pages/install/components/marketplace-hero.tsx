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
      // Named so a skin can restyle the banner as one object. The frame here
      // is `border-primary/25`, an explicit colour rather than `--border`, so
      // it does not follow a skin that repaints the app's hairlines — this is
      // the handle that lets the openagents skin ink it instead.
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
      className="relative overflow-hidden rounded-xl border border-primary/25 bg-linear-to-r from-primary/12 via-primary/5 to-transparent px-7 py-6"
    >
      {/* Ambient brand glow rather than a blown-up logo: agent marks are mostly
          near-black, so a watermark of one reads as a smudge on this surface
          instead of as decoration. Two soft blooms fill the width that a
          two-line blurb never will. Purely decorative. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-24 size-96 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -bottom-32 size-96 rounded-full bg-primary/15 blur-3xl"
      />

      {/* Every slide is laid into the same grid cell, so the banner is always
          as tall as its tallest slide. Rendering only the current one made the
          height follow each blurb: a slide whose description wrapped to a
          second line pushed the whole marketplace below it down, and the next
          slide pulled it back up. The others stay in place but invisible,
          hidden from screen readers and out of the tab order. */}
      <div className="relative grid">
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

      {/* Outside the slides on purpose — the controls are the one thing that
          must not move when the slide does. */}
      {slides.length > 1 && (
        <div className="relative mt-5 flex items-center gap-2">
          <button
            type="button"
            aria-label={t("install.hero.prev")}
            title={t("install.hero.prev")}
            onClick={prev}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
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
          <button
            type="button"
            aria-label={t("install.hero.next")}
            title={t("install.hero.next")}
            onClick={next}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
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
          ? "animate-in fade-in duration-500 ease-out slide-in-from-bottom-3 motion-reduce:animate-none"
          : "invisible",
      )}
    >
      {/* The logo, full strength and framed — it anchors the left edge far
          better than the same mark faded into the background did. */}
      <div
        data-slot="hero-mark"
        className="flex size-24 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-card/80 shadow-md backdrop-blur-sm"
      >
        <AgentIcon type={slide.name} size={52} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-2">
        <p className="m-0 text-2xs font-semibold tracking-widest text-primary uppercase">
          {t(slide.installed ? "install.hero.eyebrow" : "install.hero.eyebrowNew")}
        </p>

        <h2 className="m-0 mt-1.5 truncate text-3xl font-bold tracking-tight">
          {slide.label || slide.name}
        </h2>

        {/* Capped at three lines so one very long blurb cannot make every
            slide as tall as it is. */}
        <p className="m-0 mt-2 line-clamp-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {describeEntry(slide, t) || t("install.card.noDescription")}
        </p>

        {/* Tags sit ABOVE the CTA, on a row of their own. They used to ride
            the CTA row to save the vertical space a short tag list wastes,
            but that row wraps: four tags pushed them under the button, where
            they read as something the button produced rather than as
            metadata about the agent. A row that is occasionally sparse beats
            one that occasionally reorders itself. */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-4">
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
            <span className="font-mono text-2xs text-muted-foreground">
              {current && t("install.hero.current", { version: current })}
              {current && latest && " · "}
              {latest && t("install.hero.latest", { version: latest })}
            </span>
          )}
        </div>
      </div>

      {/* Stretches to the banner's full height so the right edge is as
          weighted as the left instead of trailing off into empty space. */}
      <dl className="m-0 grid shrink-0 gap-2 sm:grid-cols-3 lg:w-72 lg:grid-cols-1 lg:grid-rows-3 lg:self-stretch">
        {specs.map((spec) => (
          <div
            key={spec.key}
            className="flex flex-col justify-center rounded-lg border bg-card/60 px-3.5 py-2.5 backdrop-blur-sm"
          >
            <dt className="text-3xs tracking-wider text-muted-foreground uppercase">
              {t(`install.hero.spec.${spec.key}`)}
            </dt>
            <dd className="m-0 mt-1 truncate font-mono text-xs" title={spec.value}>
              {spec.value}
            </dd>
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
