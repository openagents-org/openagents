import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import type { ToastType } from "@renderer/hooks/useToast"
import { capture, group } from "@renderer/lib/analytics"
import { useAgentsStore } from "@renderer/store/agents"
import type { OnboardingAgent } from "@renderer/types"

import type { StepId } from "./onboarding-shared"

export type WorkspaceMode = "create" | "existing"

export interface OnboardingProvisionApi {
  agentName: string
  setAgentName: (v: string) => void
  agentFolder: string
  setAgentFolder: (v: string) => void
  homeDir: string
  creatingAgent: boolean
  browseFolder: () => Promise<void>
  createAgent: () => Promise<void>
  wsMode: WorkspaceMode
  setWsMode: (m: WorkspaceMode) => void
  workspaceName: string
  setWorkspaceName: (v: string) => void
  wsInvite: string
  setWsInvite: (v: string) => void
  provisioning: boolean
  finishWorkspace: () => Promise<void>
}

async function refreshAgentsStore(): Promise<void> {
  window.api.signalReload()
  await window.api
    .listAgents()
    .then((a) => useAgentsStore.getState().setAgents(a))
    .catch(() => {})
}

/**
 * The two provisioning steps: registering the first agent (name + working
 * folder) and the optional workspace binding that finishes onboarding.
 */
export function useOnboardingProvision({
  open,
  stepId,
  entry,
  showToast,
  onAgentCreated,
  onFinished,
  onNeedsAgent,
}: {
  open: boolean
  stepId: StepId
  entry: OnboardingAgent | null
  showToast: (msg: string, type?: ToastType) => void
  onAgentCreated: () => void
  onFinished: () => void
  /** Resumed straight into the workspace step with no agent — go back. */
  onNeedsAgent: () => void
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

  // Default to linking an EXISTING workspace (the common case) with
  // paste-an-invite; creating a new one is the alternative. Both are optional.
  const [wsMode, setWsMode] = useState<WorkspaceMode>("existing")
  // No default/i18n name — a new workspace is fully user-named (placeholder only).
  const [workspaceName, setWorkspaceName] = useState("")
  const [wsInvite, setWsInvite] = useState("")
  const [provisioning, setProvisioning] = useState(false)

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

  // The workspace step binds to the agent created in the previous step. If a
  // resumed session lands here without a known agent name, go back and create
  // one first rather than failing the bind on an empty name.
  useEffect(() => {
    if (!open || stepId !== "connectWorkspace") return
    if (!agentName.trim()) onNeedsAgent()
  }, [open, stepId, agentName, onNeedsAgent])

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

  // Register the agent with its chosen name + working folder. No workspace
  // yet; that's the next (optional) step. Verified + idempotent in the main
  // process.
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
        workspaceName: null,
      })
      capture("onboarding_agent_created")
      await refreshAgentsStore()
      onAgentCreated()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setCreatingAgent(false)
    }
  }, [entry, agentName, agentFolder, onAgentCreated, showToast, t])

  // Create a brand new workspace and bind the agent to it. Re-uses
  // provisionFirstAgent (the agent already exists, so add is a no-op) so the
  // create + persist + bind sequence stays atomic in one main-process call.
  const createWorkspace = useCallback(async (): Promise<void> => {
    if (!entry) return
    const wsName = workspaceName.trim()
    if (!wsName) {
      showToast(t("onboarding.flow.toast.enterWorkspaceName"), "warning")
      return
    }
    setProvisioning(true)
    try {
      const res = await window.api.provisionFirstAgent({
        agentType: entry.name,
        agentName: agentName.trim(),
        path: agentFolder.trim() || null,
        workspaceName: wsName,
      })
      if (res.workspaceName) {
        if (res.workspaceSlug) group("workspace", res.workspaceSlug)
        capture("workspace_created", {
          source: "launcher_onboarding",
          workspace_id: res.workspaceSlug,
        })
        showToast(
          t("onboarding.flow.toast.workspaceCreated", { name: res.workspaceName }),
          "success",
        )
      }
      if (res.warning) showToast(res.warning, "warning")
      await refreshAgentsStore()
      onFinished()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setProvisioning(false)
    }
  }, [entry, workspaceName, agentName, agentFolder, onFinished, showToast, t])

  // Connect to an EXISTING workspace from a pasted invite link/token: register
  // the network locally, then bind the agent to it.
  const connectExistingWorkspace = useCallback(async (): Promise<void> => {
    const invite = wsInvite.trim()
    if (!invite) {
      showToast(t("onboarding.flow.toast.enterWorkspaceLink"), "warning")
      return
    }
    setProvisioning(true)
    try {
      const isUrl = /^https?:\/\//i.test(invite)
      const ws = await window.api.registerWorkspaceFromToken(
        isUrl ? { url: invite } : { token: invite },
      )
      const slug = ws?.slug
      if (!slug) throw new Error(t("onboarding.flow.toast.workspaceResolveFailed"))
      await window.api.connectWorkspace(agentName.trim(), slug)
      group("workspace", slug)
      capture("workspace_connected", {
        source: "launcher_onboarding",
        workspace_id: slug,
      })
      showToast(
        t("onboarding.flow.toast.workspaceConnected", { name: ws.name || slug }),
        "success",
      )
      await refreshAgentsStore()
      onFinished()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setProvisioning(false)
    }
  }, [wsInvite, agentName, onFinished, showToast, t])

  return {
    agentName,
    setAgentName,
    agentFolder,
    setAgentFolder,
    homeDir,
    creatingAgent,
    browseFolder,
    createAgent,
    wsMode,
    setWsMode,
    workspaceName,
    setWorkspaceName,
    wsInvite,
    setWsInvite,
    provisioning,
    finishWorkspace:
      wsMode === "create" ? createWorkspace : connectExistingWorkspace,
  }
}
