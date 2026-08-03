import React, { useMemo, useState } from "react"
import { ArrowUpRight, Download } from "lucide-react"
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
  const [paused, setPaused] = useState(false)

  const slides = useMemo(() => pickSlides(catalog), [catalog])
  const { index, select } = useHeroCarousel(slides.length, paused)
  const hero = slides[index]

  if (!hero) return null

  const current = installed.find((r) => r.name === hero.name)?.version
  const latest = updates.find((u) => u.name === hero.name)?.latest
  const tags = (hero.tags || []).slice(0, MAX_TAGS)

  const specs = [
    { key: "runtime", value: runtimeOf(hero) || t("install.hero.builtin") },
    { key: "platforms", value: platformsOf(hero).join(" · ") || "—" },
    { key: "binary", value: hero.install?.binary || hero.name },
  ]

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
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

      {/* Keyed on the agent so React remounts it and the enter animation
          replays on every slide. */}
      <div
        key={hero.name}
        className="relative flex animate-in flex-col gap-6 fade-in duration-500 ease-out slide-in-from-bottom-3 motion-reduce:animate-none lg:flex-row lg:items-center"
      >
        {/* The logo, full strength and framed — it anchors the left edge far
            better than the same mark faded into the background did. */}
        <div className="flex size-24 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-card/80 shadow-md backdrop-blur-sm">
          <AgentIcon type={hero.name} size={52} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col lg:pl-2">
          <p className="m-0 text-2xs font-semibold tracking-widest text-primary uppercase">
            {t(hero.installed ? "install.hero.eyebrow" : "install.hero.eyebrowNew")}
          </p>

          <h2 className="m-0 mt-1.5 truncate text-3xl font-bold tracking-tight">
            {hero.label || hero.name}
          </h2>

          <p className="m-0 mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {describeEntry(hero, t) || t("install.card.noDescription")}
          </p>

          {/* Tags ride on the CTA row rather than claiming one of their own: at
              these string lengths a dedicated row was mostly whitespace. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-5">
            <Button onClick={() => onOpen(hero.name)}>
              {hero.installed ? <ArrowUpRight /> : <Download />}
              {t(hero.installed ? "install.hero.viewDetail" : "install.hero.installNow")}
            </Button>
            {(current || latest) && (
              <span className="font-mono text-2xs text-muted-foreground">
                {current && t("install.hero.current", { version: current })}
                {current && latest && " · "}
                {latest && t("install.hero.latest", { version: latest })}
              </span>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 lg:ml-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="muted" size="sm" className="font-mono">
                    {tag}
                  </Badge>
                ))}
              </div>
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

      {/* Outside the keyed block on purpose — the dots are the one thing that
          must not move when the slide does. */}
      {slides.length > 1 && (
        <div className="relative mt-5 flex items-center gap-1.5">
          {slides.map((slide, i) => (
            <button
              key={slide.name}
              type="button"
              aria-current={i === index}
              aria-label={slide.label || slide.name}
              title={slide.label || slide.name}
              onClick={() => select(i)}
              className={cn(
                "h-1.5 cursor-pointer rounded-full transition-all duration-300",
                i === index
                  ? "w-6 bg-primary"
                  : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground",
              )}
            />
          ))}
        </div>
      )}
    </section>
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
