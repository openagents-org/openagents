import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"

import { useInstallStore } from "@renderer/store/install"
import { capture } from "@renderer/lib/analytics"
import {
  installErrorMessage,
  throwIfInstallFailed,
} from "@renderer/utils/installErrors"
import type { CatalogEntry } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

export type InstallVerb = "install" | "update"

interface Options {
  loadAll: () => Promise<void>
  showToast: (msg: string, type?: ToastType) => void
  onSelect: (name: string) => void
}

interface InstallActions {
  /** Pending install/update awaiting confirmation. */
  confirmInstall: { entry: CatalogEntry; verb: InstallVerb } | null
  requestInstall: (entry: CatalogEntry, verb: InstallVerb) => void
  cancelInstall: () => void
  acceptInstall: () => void
}

/**
 * Install / update lifecycle for the catalog list. Two-step: the row action
 * only opens a confirmation, and nothing dispatches to IPC until it resolves.
 * Uninstall is not offered here — it lives on the detail page next to the
 * rollback and channel controls it belongs with.
 */
export function useInstallActions({
  loadAll,
  showToast,
  onSelect,
}: Options): InstallActions {
  const { t } = useTranslation()
  const [confirmInstall, setConfirmInstall] = useState<{
    entry: CatalogEntry
    verb: InstallVerb
  } | null>(null)

  const runInstall = useCallback(
    async (entry: CatalogEntry, verb: InstallVerb) => {
      onSelect(entry.name)
      useInstallStore.getState().startJob({ agent: entry.name, verb })
      const name = entry.label || entry.name
      try {
        throwIfInstallFailed(await window.api.installAgentTypeStreaming(entry.name))
        capture("agent_installed", { agent_type: entry.name, verb })
        showToast(
          verb === "update"
            ? t("install.toast.updated", { name })
            : t("install.toast.installed", { name }),
          "success",
        )
      } catch (e: unknown) {
        const error = installErrorMessage(e)
        showToast(
          verb === "update"
            ? t("install.toast.updateFailed", { error })
            : t("install.toast.installFailed", { error }),
          "error",
        )
      }
    },
    [showToast, onSelect, t],
  )

  return {
    confirmInstall,
    requestInstall: (entry, verb) => setConfirmInstall({ entry, verb }),
    cancelInstall: () => setConfirmInstall(null),
    acceptInstall: () => {
      const pending = confirmInstall
      setConfirmInstall(null)
      if (pending) void runInstall(pending.entry, pending.verb)
    },
  }
}
