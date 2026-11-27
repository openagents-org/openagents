import React from "react"
import { useTranslation } from "react-i18next"
import { ChevronRight, ExternalLink, RefreshCw } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { platformsOf, runtimeOf } from "@renderer/pages/install/entry-meta"
import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import type { CatalogEntry } from "@renderer/types"

/**
 * What the type's marketplace page used to say before the form: its version
 * (and the update, when one is out), where it runs, and where to read more.
 * The marketplace now opens the form directly, so this is the short version
 * of that page; its full one — version history, uninstall — is one click
 * away through `onOpenType`.
 */
export function SetupTypeInfo({
  entry,
  onOpenType,
}: {
  entry: CatalogEntry
  /** The type's marketplace page, where its update and uninstall run. */
  onOpenType?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const installed = useInstallStore((s) => s.installed.find((i) => i.name === entry.name))
  const updates = useInstallStore((s) => s.updates)
  const update = hasPendingUpdate(updates, entry.name) ? updates.find((u) => u.name === entry.name) : undefined
  const version = update?.current || installed?.version
  const platforms = platformsOf(entry)

  const links = [
    entry.homepage && { label: t("agents.shared.aside.homepage"), url: entry.homepage },
    entry.github && { label: t("agents.header.github"), url: entry.github },
    entry.docs && { label: t("agents.header.docs"), url: entry.docs },
  ].filter((l): l is { label: string; url: string } => !!l)

  const rows = [
    {
      key: "version",
      label: t("agents.shared.aside.version"),
      value: !entry.installed
        ? <span className="text-muted-foreground">{t("agents.shared.aside.notInstalled")}</span>
        : version
          ? <span className="font-mono">v{version}</span>
          : <span>{t("agents.shared.aside.installed")}</span>,
    },
    platforms.length > 0 && {
      key: "platforms",
      label: t("agents.requirements.platforms"),
      value: <span>{platforms.join(" · ")}</span>,
    },
    {
      key: "runtime",
      label: t("agents.requirements.runtime"),
      value: <span className="font-mono">{runtimeOf(entry) || t("install.hero.builtin")}</span>,
    },
    links.length > 0 && {
      key: "links",
      label: t("agents.shared.aside.links"),
      value: (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {links.map((l) => (
            <a key={l.url} href="#" className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={(e) => { e.preventDefault(); window.api.openExternal(l.url) }}>
              {l.label}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </span>
      ),
    },
  ].filter((r): r is { key: string; label: string; value: React.JSX.Element } => !!r)

  return (
    <div data-testid="setup-type-info">
      <h2 className="m-0 mb-2 text-base font-semibold">{t("agents.shared.aside.about")}</h2>
      <dl className="m-0 divide-y">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-4 py-3.5 text-sm">
            <dt className="w-20 shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="m-0 flex min-w-0 items-center gap-2">{row.value}</dd>
          </div>
        ))}
      </dl>
      {onOpenType && (
        // Full width of the rail, at the form's own button size: the update is
        // the one action here, and a small button floated at the left of an
        // empty column read as an afterthought.
        <div className="mt-4 flex flex-col gap-1">
          {update?.latest && (
            <Button size="lg" className="w-full" onClick={onOpenType} data-testid="setup-type-update">
              <RefreshCw data-icon="inline-start" />
              {t("agents.actions.updateToVersion", { version: update.latest })}
            </Button>
          )}
          {entry.installed && (
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={onOpenType}
              data-testid="setup-type-manage">
              {t("agents.shared.aside.manage")}
              <ChevronRight data-icon="inline-end" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
