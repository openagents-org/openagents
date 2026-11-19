import type React from 'react';
import type { MessageKey } from '@/lib/i18n';
import type { AgentCatalogEntry, AgentCatalogDetail, WorkspaceNode, NodeAgent, NodeCommand, ModelAccessEntry, ModelProbeResult } from '@/lib/types';

/** Agents of the chosen type listed before the rest fold behind "Show all". */
export const SAME_TYPE_SHOWN = 3;

export interface AgentSetupApi {
  getAgentCatalogDetail(type: string): Promise<AgentCatalogDetail>;
  /** `deferred`: the create waits on a runtime install and finishes after the form closes; the host reports the outcome. */
  enqueueNodeCommand(nodeId: string, action: string, args: Record<string, unknown>): Promise<{ commandId?: string; deferred?: boolean }>;
  listNodeCommands(nodeId: string): Promise<NodeCommand[]>;
  listModelAccess(): Promise<ModelAccessEntry[]>;
  probeModelAccess(id: string, model?: string, protocol?: 'openai' | 'anthropic'): Promise<ModelProbeResult>;
}

export interface AgentSetupExtensions {
  /** Guided web onboarding; existing-agent settings and native desktop forms stay separate. */
  guided?: boolean;
  local?: boolean;
  disabled?: boolean;
  /** `workingDirectory` is set when `inlineWorkingDirectory` is: the folder's
   *  value and setter, for the host to draw in its own field style inside its
   *  configuration (beside the model, say). */
  configuration?: (props: { type: string; name?: string; onChanged: () => void; workingDirectory?: { value: string; onChange: (value: string) => void } }) => React.ReactNode;
  /** Let `configuration` draw the working-directory field instead of drawing
   *  it below the form. */
  inlineWorkingDirectory?: boolean;
  workingDirectoryHint?: string;
  workingDirectoryPlaceholder?: string;
  browseFolder?: (current: string) => Promise<string | null>;
  /** Agent names already used across the workspace, beyond this device's own. */
  takenNames?: readonly string[];
  /** Sets an existing agent's display name. Offered only where the host can do it. */
  renameAgent?: (name: string, displayName: string) => Promise<void>;
  /** Where the host can sign an agent in on this device: the action for a
   *  type that signs in, or undefined. Offered beside "Needs login" in place
   *  of the docs link. */
  signIn?: (type: string) => (() => void) | undefined;
  modelAccessDialog?: (props: { onClose: () => void; onSaved: (entry: ModelAccessEntry) => void }) => React.ReactNode;
  promo?: (props: { agentType: string; accesses: ModelAccessEntry[] | null; selectedAccessId: string; onUse: (entry: ModelAccessEntry, created: boolean) => void }) => React.ReactNode;
  /** Put Back and Save beside the agent hero instead of in a footer band, which
   *  leaves the bottom-right corner to the host's toasts. */
  headerActions?: boolean;
  /** Desktop layout: a compact two-column type list instead of the gallery,
   *  and a titled form with an info column beside it. Hosts other than the
   *  desktop app leave it off and keep the gallery. */
  compact?: boolean;
  /** Compact only: the breadcrumb's first step, naming the page this opened from. */
  breadcrumbRoot?: string;
  /** Compact only: the column beside the form (type, device, workspace). */
  aside?: (props: { type: string }) => React.ReactNode;
}

/** What an add was submitted with — enough to reopen the form when it fails on the device. */
export interface AgentDraft {
  name: string;
  type: string;
  workingDir?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  modelAccessId?: string;
  codexWireApi?: 'responses' | 'chat';
  /** The agent's own credential fields (e.g. CodeArts AK/SK). */
  config?: Record<string, string>;
}

/** Where the host's agent catalog load stands — the gallery is empty until it lands. */
export interface CatalogState {
  status: 'loading' | 'ready' | 'error';
  retry: () => void;
}

export interface AgentSetupProps {
  node: WorkspaceNode;
  catalog: AgentCatalogEntry[];
  /** How the host's catalog load is going. Hosts that hand over a catalog they
   *  already have leave it out. */
  catalogState?: CatalogState;
  api: AgentSetupApi;
  extensions?: AgentSetupExtensions;
  contextLabel?: React.ReactNode;
  editAgent?: NodeAgent;
  /** Open straight on this type's form rather than the gallery. Ignored when editing. */
  initialType?: string;
  /** Reopen the add form filled in from a failed add; the name stays editable. */
  draft?: AgentDraft;
  /** Why the device refused `draft`. */
  draftFailure?: string | null;
  onManageAgent?: (agent: NodeAgent) => void;
  onBack: () => void;
  onChanged: () => void;
  onQueued?: (agent: { name: string; type: string; commandId?: string; draft?: AgentDraft }) => void;
}

export const NO_ACCESS = '__none__';
// Editing an agent that runs on a key: keep it as it is. The form cannot pick
// the saved access it came from, and a key saved on the device (the launcher
// saves them there) has none.
export const KEEP_CURRENT = '__keep_current__';
// A key-only agent on the key its type has on the device (<type>.env, the
// launcher's Credentials, an environment variable): nothing to send for it.
export const DEVICE_KEY = '__device_key__';
// The account the type's CLI is signed in to on the device, offered for every
// type with a sign-in and picked for the user once the device says it is.
export const SIGN_IN = '__sign_in__';
export const AUTO_MODEL = '__auto__';
export const CUSTOM_MODEL = '__custom__';
/** How long "Detecting…" may stay up before it gives way to a retry. */
export const DETECT_DEADLINE_MS = 45_000;
/** Types whose endpoint is one device-wide config file of their own, so every
 *  agent of the type on a device runs on the same key, endpoint and model.
 *  Mirrors SHARED_NATIVE_CONFIG in packages/agent-connector/src/daemon.js;
 *  every other type keeps what this form sends on the agent alone. */
export const SHARED_CONFIG_TYPES = new Set(['hermes']);

/**
 * CLIs that sign in to an account although the registry gives them no
 * `login_command`. Declaring one there would also change how the form and the
 * device treat their keys and models, so they are named here for the hint only.
 * A device with `agn login` reports that command instead (EXTRA_LOGIN_COMMANDS
 * in the connector's agent-login.js); this is what an older one is shown.
 */
export const HINT_ONLY_SIGN_IN: Record<string, { command: string; note: MessageKey }> = {
  // In `opencode auth login` (1.19.5) OpenAI offers a ChatGPT Plus/Pro sign-in
  // and GitHub Copilot a GitHub one; every other provider only takes a key.
  opencode: { command: 'opencode auth login', note: 'connect.nodeNeedsLoginOpencodeNote' },
};
