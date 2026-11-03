import React from "react"
import { useTranslation } from "react-i18next"
import { Folder, Monitor } from "lucide-react"

import type { CatalogEntry } from "@renderer/types"
import { SetupTypeInfo } from "./setup-type-info"

/**
 * The column beside the agent form: where it runs, and which workspace it is
 * in — or that one is picked after adding it. Below that, what the type's
 * marketplace page says about it. Not the type itself: the page title already
 * names it, with its mark.
 */
export function SetupAside({
  type,
  workspace,
  entry,
  onOpenType,
}: {
  type: string
  workspace: string | null
  entry?: CatalogEntry
  onOpenType?: (type: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rows = [
    { key: "device", value: <><Monitor className="size-4 shrink-0" /><span>{t("agents.shared.thisComputer")}</span></> },
    {
      key: "workspace",
      value: workspace
        ? <><Folder className="size-4 shrink-0" /><span className="truncate">{workspace}</span></>
        : <><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">{t("agents.shared.aside.pickLater")}</span></>,
    },
  ]
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="m-0 mb-2 text-base font-semibold">{t("agents.shared.aside.title")}</h2>
        <dl className="m-0 divide-y">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-4 py-3.5 text-sm">
              <dt className="w-20 shrink-0 text-muted-foreground">{t(`agents.shared.aside.${row.key}`)}</dt>
              <dd className="m-0 flex min-w-0 items-center gap-2">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {entry && <SetupTypeInfo entry={entry} onOpenType={onOpenType && (() => onOpenType(type))} />}
    </div>
  )
}
