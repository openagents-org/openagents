'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentCatalogDetail, NodeAgent, NodeRuntime, WorkspaceNode } from '@/lib/types';
import { HINT_ONLY_SIGN_IN } from './agent-setup-types';

/**
 * What the agent will run on — a saved key, the key it already has, the key
 * its type has on the device or the CLI's own sign-in — and whether that is
 * enough to add it.
 */
export function useAgentCredentials({ node, editAgent, editOnKey, detail, selected, runtimeByType, byok, accessId, apiKey, model, baseUrl, modelOptions, configured }: {
  node: WorkspaceNode;
  editAgent?: NodeAgent;
  editOnKey: boolean;
  detail: AgentCatalogDetail | null;
  selected: string | null;
  runtimeByType: Record<string, NodeRuntime>;
  byok: boolean;
  accessId: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  modelOptions?: { id: string; label: string }[];
  /** The host draws the configuration itself. */
  configured: boolean;
}) {
  const isEdit = !!editAgent;
  const [keepCurrent, setKeepCurrent] = useState(editOnKey);
  // A type whose CLI has its own sign-in (codex login, claude login…): an
  // agent on it is marked so on the device (authMode), or it would run on
  // whatever key the device saved for its type.
  const signInType = byok && !!detail?.check_ready?.login_command;
  const loginCommand = detail?.check_ready?.login_command || '';
  const selectedRuntime = selected ? runtimeByType[selected] : undefined;
  // The command that signs the CLI in on the device, where it has one.
  const deviceLoginCommand = selectedRuntime?.loginCommand || loginCommand
    || (selected && HINT_ONLY_SIGN_IN[selected]?.command) || '';
  // A type with no sign-in of its own at all (DeepSeek, Qwen Code, OpenClaw…).
  const keyOnly = byok && !deviceLoginCommand;
  const noKeyPicked = !accessId && !keepCurrent && !apiKey.trim();
  // A type with a sign-in always offers it. Whether the device is signed in
  // is a best guess for some (codex and codebuddy are `unverifiable`), so it
  // only picks the default and the message: a signed-in user the detection
  // missed must still be able to pick their own account. `signedIn` from
  // devices new enough; a type ready on its sign-in, or ready at all, from
  // older ones.
  const signInOffered = byok && !keyOnly;
  const signedInOnDevice = !!selectedRuntime?.installed && !!(selectedRuntime.signedIn
    ?? (selectedRuntime.auth ? selectedRuntime.auth.mode === 'subscription' : selectedRuntime.ready));
  // Null until picked, so the default follows a detection that can arrive
  // after the form opens. An agent being edited opens on the sign-in it runs
  // on: one marked so, or, from a device too old to say, one with no key of
  // its own.
  const [signInPick, setSignInPick] = useState<boolean | null>(editAgent
    ? editAgent.authMode === 'cli_login' || (editAgent.authMode === undefined && !editOnKey)
    : null);
  const onSignIn = signInOffered && noKeyPicked && (signInPick ?? signedInOnDevice);
  // With no key, a sign-in agent runs on the CLI's sign-in, and the device is
  // told so (authMode), or it would run on whatever key it saved for the type.
  const signInChosen = signInType && noKeyPicked;
  // The key a key-only type has on the device (typeReady), which an agent
  // with none of its own runs on, and so opens on when edited. A new agent
  // opens on it too: the device is known to hold a key, so it is not refused.
  // An agent on a key of its own keeps that. Null until picked, like
  // signInPick, so the default follows a detection that arrives late.
  const deviceKeyOffered = keyOnly && !editOnKey && !!selectedRuntime?.typeReady;
  const [useDeviceKey, setUseDeviceKey] = useState<boolean | null>(editAgent ? !editOnKey : null);
  const onDeviceKey = deviceKeyOffered && (useDeviceKey ?? true) && noKeyPicked;
  // OpenCode Zen's free `opencode/…` models need neither.
  const keylessModel = (detail?.check_ready?.keyless_model_prefixes || [])
    .some((prefix) => !!prefix && model.trim().startsWith(prefix));
  // A key-only agent cannot answer without a key, and "no key" is reliable
  // for it: an add with none is refused every time ("Add anyway" let in
  // DeepSeek agents that failed on their first message). An edit is refused
  // only once its credentials were changed: a rename goes through.
  const keyMissing = keyOnly && noKeyPicked && !onDeviceKey && !keylessModel;
  const [credsTouched, setCredsTouched] = useState(false);
  const keyRequired = keyMissing && (!isEdit || credsTouched);
  // A sign-in agent the device does not look signed in for: said, and an add
  // asks once more ("Add anyway"), since the detection can be wrong and
  // signing in later is a fine plan. Never a block, and an edit only warns.
  // One not installed yet cannot be signed in before it exists.
  const signInUnconfirmed = signInOffered && noKeyPicked && !keylessModel
    && !!selectedRuntime?.installed && !signedInOnDevice;
  const [credsError, setCredsError] = useState(false);
  const credsFieldRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setCredsError(false); }, [keyMissing, signInUnconfirmed, selected]);
  // The models the device's own CLI offers its sign-in (a ChatGPT or Claude
  // subscription), for an agent that will run on that sign-in ("sign in on
  // the device" picked) rather than on a key. The catalog's list is the
  // vendor's line-up, kept by hand: it offered models the account behind the
  // sign-in is not served, and missed ones it is. The edited agent's own
  // answer comes first; a new agent gets what its type's CLI said for the
  // device. Null on a launcher too old to ask and until the CLI has
  // answered: the catalog stands in.
  const accountModels = useMemo(() => {
    if (!signInChosen || !selected || baseUrl.trim()) return null;
    // The device sends an agent's own list only while it is on its sign-in.
    if (editAgent?.type === selected && editAgent.cliModels?.length) return editAgent.cliModels;
    const runtime = runtimeByType[selected];
    return runtime?.cliModels?.length ? runtime.cliModels : null;
  }, [signInChosen, selected, baseUrl, editAgent, runtimeByType]);
  const pickerModels = useMemo(
    () => (accountModels ? accountModels.map((m) => ({ id: m.id, label: m.label || m.id })) : modelOptions),
    [accountModels, modelOptions],
  );
  // A model the list does not hold (one saved before, or one the account is
  // no longer offered) is still shown as the one picked, not as a blank.
  const unlistedModel = model.trim() && pickerModels && !pickerModels.some((m) => m.id === model.trim()) ? model.trim() : null;
  const currentKeyDetail = [editAgent?.apiKeyMasked, editAgent?.baseUrlHost].filter(Boolean).join(' · ');
  const customCodex = selected === 'codex' && !configured && Boolean(accessId || baseUrl.trim() || (editAgent?.baseUrlHost && keepCurrent));
  const launcherParts = (node.launcherVersion || '').replace(/^v/, '').split('.').map(Number);
  const supportsCodexMode = launcherParts[0] > 0 || launcherParts[1] > 2 || (launcherParts[1] === 2 && launcherParts[2] >= 197);

  return {
    keepCurrent, setKeepCurrent, loginCommand, deviceLoginCommand, keyOnly,
    signInOffered, onSignIn, setSignInPick, signInChosen,
    deviceKeyOffered, onDeviceKey, setUseDeviceKey,
    keyMissing, keyRequired, setCredsTouched, signInUnconfirmed,
    credsError, setCredsError, credsFieldRef,
    accountModels, pickerModels, unlistedModel, currentKeyDetail, customCodex, supportsCodexMode,
  };
}

export type CredentialsState = ReturnType<typeof useAgentCredentials>;
