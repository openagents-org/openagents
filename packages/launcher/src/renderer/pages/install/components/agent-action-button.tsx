import React from "react"
import { Download, RefreshCw, Settings2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import type { InstallJob } from "@renderer/store/install"

import { isJobBusy, type EntryStatus } from "../entry-meta"

/** Streamed verb → the label shown while that job runs. */
const BUSY_LABEL: Record<InstallJob["verb"], string> = {
  install: "install.card.verb.installing",
  update: "install.card.verb.updating",
  uninstall: "install.card.verb.uninstalling",
  rollback: "install.card.verb.rollingBack",
}

export interface AgentActionProps {
  /** Catalog slug — also the e2e handle (`install-btn-<slug>`). */
  name: string
  status: EntryStatus
  job: InstallJob | undefined
  /** Install or update in place, from the list. */
  onInstall: () => void
  /** Open the detail page, where uninstall / channel / config live. */
  onManage: () => void
}

/**
 * The single action a catalog row offers. Deliberately one button: an already
 * installed agent has more than one thing you might want to do with it, and
 * "Manage" hands all of them to the detail page instead of crowding every row
 * with a second and third control.
 */
export function AgentActionButton({
  name,
  status,
  job,
  onInstall,
  onManage,
}: AgentActionProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (status === "comingSoon") return null

  if (isJobBusy(job) && job) {
    return (
      <Button size="sm" variant="secondary" disabled>
        <Spinner />
        {t(BUSY_LABEL[job.verb])}
      </Button>
    )
  }

  if (status === "update") {
    return (
      <Button size="sm" data-testid={`install-btn-${name}`} onClick={onInstall}>
        <RefreshCw />
        {t("install.card.update")}
      </Button>
    )
  }

  if (status === "installed") {
    return (
      <Button size="sm" variant="outline" onClick={onManage}>
        <Settings2 />
        {t("install.card.manage")}
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      data-testid={`install-btn-${name}`}
      onClick={onInstall}
    >
      <Download />
      {t("install.card.install")}
    </Button>
  )
}
