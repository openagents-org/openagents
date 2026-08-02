import React from "react"
import { useTranslation } from "react-i18next"
import AgentIcon from "../AgentIcon"
import type { CatalogEntry } from "../../types"

interface Props {
  catalog: CatalogEntry[]
  onOpen: (name: string) => void
}

export function FeaturedBanner({ catalog, onOpen }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const hero =
    catalog.find((c) => c.featured && !c.installed) ||
    catalog.find((c) => c.featured) ||
    catalog[0] ||
    null

  const title = hero?.label || hero?.name || t("install.featuredBanner.defaultTitle")
  const description =
    hero?.description ||
    hero?.long_description ||
    t("install.featuredBanner.defaultDescription")
  const ctaLabel = hero
    ? hero.installed
      ? t("install.featuredBanner.open")
      : t("install.featuredBanner.installNow")
    : t("install.featuredBanner.browseAll")

  return (
    <div className="relative box-border rounded-xl pl-8 pr-45 py-7 shadow-[0_4px_20px_rgba(99,102,241,0.25)] bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_50%,#7c3aed_100%)]">
      <div className="absolute top-7 right-7 w-33 h-33 rounded-2xl bg-white/15 flex items-center justify-center">
        {hero ? (
          <AgentIcon type={hero.name} size={72} />
        ) : (
          <div className="w-14 h-14 rounded-full bg-white/30" />
        )}
      </div>

      <div className="mb-3 text-3xs font-bold uppercase tracking-widest text-white/85">
        {t("install.featuredBanner.eyebrow")}
      </div>

      <h2 className="m-0 text-2xl font-extrabold leading-tight tracking-tight text-white">
        {title}
      </h2>

      <p className="mt-2.5 mb-0 max-w-135 text-base leading-relaxed text-white/90">
        {description}
      </p>

      <button
        type="button"
        onClick={() => {
          if (hero) onOpen(hero.name)
        }}
        disabled={!hero}
        className="mt-5.5 inline-block cursor-pointer rounded-md border-0 bg-white px-5 py-2.5 text-sm font-bold text-indigo-600 shadow-md disabled:cursor-not-allowed disabled:opacity-60"
      >
        {ctaLabel}
      </button>
    </div>
  )
}
