import React from "react"
import { useTranslation } from "react-i18next"
import { Folder, Monitor } from "lucide-react"

import AgentIcon from "@renderer/components/AgentIcon"

/**
 * The column beside the agent form: which type this is, where it runs, and
 * which workspace it is in — or that one is picked after adding it.
 */
export function SetupAside({
  type,
  label,
  workspace,
}: {
  type: string
  label: string
  workspace: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const rows = [
    { key: "type", value: <><AgentIcon type={type} size={20} /><span className="truncate">{label}</span></> },
    { key: "device", value: <><Monitor className="size-4 shrink-0" /><span>{t("agents.shared.thisComputer")}</span></> },
    {
      key: "workspace",
      value: workspace
        ? <><Folder className="size-4 shrink-0" /><span className="truncate">{workspace}</span></>
        : <><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">{t("agents.shared.aside.pickLater")}</span></>,
    },
  ]
  return (
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
  )
}
