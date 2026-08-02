import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"

import { useInstallStore } from "@renderer/store/install"
import { isLoginOnlyAgent } from "@renderer/lib/agent-auth"
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
  onOpenWizard: (entry: CatalogEntry) => void
}

interface InstallActions {
  /** Pending install/update awaiting confirmation. */
  confirmInstall: { entry: CatalogEntry; verb: InstallVerb } | null
  requestInstall: (entry: CatalogEntry, verb: InstallVerb) => void
  cancelInstall: () => void
  acceptInstall: () => void
  confirmUninstall: CatalogEntry | null
  requestUninstall: (entry: CatalogEntry) => void
  cancelUninstall: () => void
  acceptUninstall: (wipeEnv: boolean) => Promise<void>
  maybeOpenWizard: (entry: CatalogEntry) => Promise<void>
}

/**
 * Install / uninstall lifecycle. Both are two-step: the card action only opens
 * a confirmation, and nothing dispatches to IPC until it resolves.
 */
export function useInstallActions({
  loadAll,
  showToast,
  onSelect,
  onOpenWizard,
}: Options): InstallActions {
  const { t } = useTranslation()
  const installedList = useInstallStore((s) => s.installed)
  const [confirmInstall, setConfirmInstall] = useState<{
    entry: CatalogEntry
    verb: InstallVerb
  } | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<CatalogEntry | null>(null)

  // Open the post-install setup wizard, UNLESS the agent signs in only through
  // its own CLI (Cursor, Hermes). Those have no API key to collect, so the
  // wizard (enter key → test → create) is meaningless — their sign-in lives in
  // the Agents-page Configure dialog. We probe getEnvFields here because a
  // catalog entry's own env_config can't be trusted (Cursor still lists
  // CURSOR_API_KEY there even though the launcher hides it).
  const maybeOpenWizard = useCallback(
    async (entry: CatalogEntry) => {
      try {
        const fields = await window.api.getEnvFields(entry.name)
        if (isLoginOnlyAgent(entry, fields)) return
      } catch {
        /* fall through and open the wizard if we can't determine the auth mode */
      }
      onOpenWizard(entry)
    },
    [onOpenWizard],
  )

  const runInstall = useCallback(
    async (entry: CatalogEntry, verb: InstallVerb) => {
      onSelect(entry.name)
      const wasInstalled = installedList.some((r) => r.name === entry.name)
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
        if (!wasInstalled && verb === "install") maybeOpenWizard(entry)
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
    [showToast, installedList, maybeOpenWizard, onSelect, t],
  )

  const acceptUninstall = useCallback(
    async (wipeEnv: boolean) => {
      const entry = confirmUninstall
      if (!entry) return
      setConfirmUninstall(null)
      useInstallStore.getState().startJob({ agent: entry.name, verb: "uninstall" })
      try {
        await window.api.uninstallAgentTypeStreaming(entry.name)
        capture("agent_uninstalled", { agent_type: entry.name, wipe_env: wipeEnv })
        if (wipeEnv) {
          try {
            await window.api.deleteAgentEnv(entry.name)
          } catch {
            /* non-fatal — uninstall already succeeded */
          }
        }
        showToast(
          t("install.toast.uninstalled", { name: entry.label || entry.name }),
          "success",
        )
      } catch (e: unknown) {
        showToast(
          t("install.toast.uninstallFailed", { error: (e as Error).message }),
          "error",
        )
      } finally {
        await loadAll()
      }
    },
    [confirmUninstall, showToast, loadAll, t],
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
    confirmUninstall,
    requestUninstall: setConfirmUninstall,
    cancelUninstall: () => setConfirmUninstall(null),
    acceptUninstall,
    maybeOpenWizard,
  }
}
