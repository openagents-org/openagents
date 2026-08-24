import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import type { ToastType } from "@renderer/hooks/useToast"
import { capture, group } from "@renderer/lib/analytics"
import { useAgentsStore } from "@renderer/store/agents"
import type { OnboardingAgent } from "@renderer/types"

import type { StepId } from "./onboarding-shared"

export interface PairedWorkspaceRef {
  slug: string
  name: string | null
}

export interface OnboardingProvisionApi {
  agentName: string
  setAgentName: (v: string) => void
  agentFolder: string
  setAgentFolder: (v: string) => void
  homeDir: string
  creatingAgent: boolean
  browseFolder: () => Promise<void>
  /**
   * Creates the agent, binds it to the paired workspace when there is one,
   * and finishes onboarding — the terminal action of the flow.
   */
  createAgent: () => Promise<void>
  /** The workspace the agent will connect to, or null for local-only. */
  pairedWorkspace: PairedWorkspaceRef | null
}

async function refreshAgentsStore(): Promise<void> {
  window.api.signalReload()
  await window.api
    .listAgents()
    .then((a) => useAgentsStore.getState().setAgents(a))
    .catch(() => {})
}

/**
 * The final provisioning step: register the first agent (name + working
 * folder) and bind it to the workspace this device is paired with. There is
 * no separate workspace step anymore — pairing happened earlier in the flow
 * (or is skipped, leaving the agent local-only until connected later).
 */
export function useOnboardingProvision({
  open,
  stepId,
  entry,
  showToast,
  onFinished,
}: {
  open: boolean
  stepId: StepId
  entry: OnboardingAgent | null
  showToast: (msg: string, type?: ToastType) => void
  onFinished: () => void
}): OnboardingProvisionApi {
  const { t } = useTranslation()

  // An explicit name + working folder. The name is not auto-derived as
  // "<type>-1" — the user names the agent and chooses where it runs.
  const [agentName, setAgentName] = useState("")
  const [agentFolder, setFolder] = useState("")
  // Once the user edits/browses the folder, stop auto-syncing it to the default
  // so we never clobber a deliberate choice.
  const [folderTouched, setFolderTouched] = useState(false)
  const [homeDir, setHomeDir] = useState("")
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [pairedWorkspace, setPairedWorkspace] =
    useState<PairedWorkspaceRef | null>(null)

  // Resolve the home directory once we reach the create-agent step, so the
  // folder field can prefill a sensible default working directory.
  useEffect(() => {
    if (!open || stepId !== "createAgent" || homeDir) return
    window.api
      .listPaths()
      .then((p) => setHomeDir(p?.home || ""))
      .catch(() => {})
  }, [open, stepId, homeDir])

  useEffect(() => {
    if (!open || stepId !== "createAgent" || folderTouched) return
    if (homeDir && homeDir !== agentFolder) setFolder(homeDir)
  }, [open, stepId, folderTouched, homeDir, agentFolder])

  // Read the pairing directly from the node status rather than threading it
  // through from the pairing step — a resumed session lands here with the
  // pairing hook's state empty, but node.json still knows the workspace.
  useEffect(() => {
    if (!open || stepId !== "createAgent") return
    window.api
      .getNodeStatus()
      .then((s) => {
        if (s?.workspaceSlug) {
          setPairedWorkspace({
            slug: s.workspaceSlug,
            name: s.workspaceName || null,
          })
        }
      })
      .catch(() => {})
  }, [open, stepId])

  const setAgentFolder = useCallback((v: string): void => {
    setFolderTouched(true)
    setFolder(v)
  }, [])

  const browseFolder = useCallback(async (): Promise<void> => {
    try {
      const picked = await window.api.selectDirectory(
        agentFolder || homeDir || undefined,
      )
      if (picked) setAgentFolder(picked)
    } catch (e) {
      showToast((e as Error).message, "error")
    }
  }, [agentFolder, homeDir, setAgentFolder, showToast])

  // Register the agent, bind it to the paired workspace when there is one,
  // and finish onboarding. The bind is by slug — no token, no resolve.
  const createAgent = useCallback(async (): Promise<void> => {
    if (!entry) return
    const name = agentName.trim()
    const folder = agentFolder.trim()
    if (!name) {
      showToast(t("onboarding.flow.toast.enterAgentName"), "warning")
      return
    }
    if (!folder) {
      showToast(t("onboarding.flow.toast.selectFolder"), "warning")
      return
    }
    setCreatingAgent(true)
    try {
      await window.api.provisionFirstAgent({
        agentType: entry.name,
        agentName: name,
        path: folder,
      })
      capture("onboarding_agent_created")
      if (pairedWorkspace) {
        try {
          await window.api.connectWorkspace(name, pairedWorkspace.slug)
          group("workspace", pairedWorkspace.slug)
          capture("workspace_connected", {
            source: "launcher_onboarding",
            workspace_id: pairedWorkspace.slug,
          })
          showToast(
            t("onboarding.flow.toast.workspaceConnected", {
              name: pairedWorkspace.name || pairedWorkspace.slug,
            }),
            "success",
          )
        } catch (e) {
          // The agent exists either way; a failed bind shouldn't strand the
          // wizard. Surface it and let the Agents page finish the job.
          showToast((e as Error).message, "warning")
        }
      }
      await refreshAgentsStore()
      onFinished()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setCreatingAgent(false)
    }
  }, [
    entry,
    agentName,
    agentFolder,
    pairedWorkspace,
    onFinished,
    showToast,
    t,
  ])

  return {
    agentName,
    setAgentName,
    agentFolder,
    setAgentFolder,
    homeDir,
    creatingAgent,
    browseFolder,
    createAgent,
    pairedWorkspace,
  }
}
