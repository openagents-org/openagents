'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { deviceNameClash } from '@/lib/node-command-error';
import { defaultAgentNameBase, uniqueAgentName } from '@/lib/agent-name';
import type { AgentCatalogDetail } from '@/lib/types';
import type { AgentSetupProps } from './agent-setup-types';
import { runtimeStatus } from './agent-setup-status';
import { useRuntimeDetection } from './use-runtime-detection';
import { useByokModels } from './use-byok-models';
import { useAgentCredentials } from './use-agent-credentials';

/** Every value the agent form shows and edits, and how they depend on each other. */
export function useAgentSetupForm({ node, catalog, api, extensions, editAgent, initialType, draft, draftFailure, onChanged }: AgentSetupProps) {
  const t = useT();
  const isEdit = !!editAgent;
  const guided = !!extensions?.guided && !isEdit && !extensions?.compact && !extensions?.configuration;
  const takenNames = useMemo(
    () => new Set([...node.agents.map((agent) => agent.name), ...(extensions?.takenNames ?? [])]),
    [node.agents, extensions?.takenNames],
  );
  const startType = editAgent ? null : draft?.type ?? initialType ?? null;
  const [selected, setSelected] = useState<string | null>(editAgent?.type ?? startType);
  const [name, setName] = useState(editAgent?.name ?? draft?.name ?? (startType ? uniqueAgentName(defaultAgentNameBase(startType), takenNames) : ''));
  // The label people see, editable after creation — unlike `name`, which is the
  // agent's identity (config, env files, @mentions) and stays fixed.
  const [displayName, setDisplayName] = useState(editAgent?.displayName ?? '');
  const canRename = isEdit && !!extensions?.renameAgent;
  // A typed name belongs to the type it was typed for: re-picking that type keeps
  // it (a typed "claudecbd" must not revert to "claude"), but switching to a
  // different type reseeds — otherwise "kimi-1019" lands on a DeepSeek agent.
  const nameTouchedFor = useRef<string | null>(draft?.type ?? null);
  const [workingDir, setWorkingDir] = useState(editAgent?.workingDir ?? draft?.workingDir ?? '');
  const [showAllSameType, setShowAllSameType] = useState(false);
  const [apiKey, setApiKey] = useState(draft?.apiKey ?? '');
  // Custom OpenAI/Anthropic-compatible endpoint. Without this field a key was
  // only usable against an agent's built-in providers — for hermes (whose key
  // is meaningless without an endpoint) the form was a dead end. The daemon's
  // create/configure commands have always accepted baseUrl; the form just
  // never sent it.
  const [baseUrl, setBaseUrl] = useState(draft?.baseUrl ?? '');
  const [model, setModel] = useState(editAgent?.model ?? draft?.model ?? '');
  const [customModel, setCustomModel] = useState(false);
  const [codexWireApi, setCodexWireApi] = useState<'responses' | 'chat'>(editAgent ? (editAgent.codexWireApi || 'chat') : (draft?.codexWireApi ?? 'responses'));
  // When editing an agent that has a key on the node, open the credentials
  // section up front so the masked key (and the keep-if-blank rule) is visible
  // — otherwise the collapsed section reads as "no key saved".
  const [showCreds, setShowCreds] = useState(!!editAgent?.apiKeyMasked || !!draft?.apiKey || !!draft?.baseUrl);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Name problems sit under the name field, not with the form-wide error, so
  // a taken name is fixed where it is typed and nothing else is cleared.
  const [nameError, setNameError] = useState<string | null>(null);
  // Marketplace toolbar state (selection mode).
  const [marketQuery, setMarketQuery] = useState('');
  const [marketCat, setMarketCat] = useState('all');
  const detection = useRuntimeDetection(node, api, onChanged);
  const { runtimeByType } = detection;

  const selectedEntry = catalog.find((e) => e.name === selected);
  // An agent on a key opens on that key, not on "sign in on the device": the
  // select showed the sign-in for an agent running on a relay key, which is
  // exactly how nobody could tell which of a device's two codex setups an
  // agent was on. Devices that do not report authMode say so by a key or an
  // endpoint of their own.
  const editOnKey = !!editAgent && (editAgent.authMode !== undefined
    ? editAgent.authMode === 'api_key'
    : !!(editAgent.apiKeyMasked || editAgent.baseUrlHost));
  // An agent being edited is judged on what it runs on, not on its type.
  const selectedStatus = runtimeStatus(selected ? runtimeByType[selected] : undefined, editOnKey);
  const signIn = selected && selectedStatus === 'needs_login' ? extensions?.signIn?.(selected) : undefined;

  // Say a name is taken while it is typed, not after the device refuses it. A
  // name the device refused last time stays flagged on retry: that agent is
  // not in this roster, so nothing else here knows about it.
  const trimmedName = name.trim();
  const nameClash = isEdit || !trimmedName ? null
    : node.agents.some((agent) => agent.name === trimmedName) ? t('connect.agentNameExists')
    : takenNames.has(trimmedName) ? t('connect.agentNameTaken', { name: trimmedName })
    : deviceNameClash(draftFailure) === trimmedName ? t('connect.agentNameOnDevice', { name: trimmedName })
    : null;

  // Registry detail for the selected type: fixed model list (claude/gemini/…)
  // and whether the agent is bring-your-own-provider (generic LLM_* mapping).
  const [detail, setDetail] = useState<AgentCatalogDetail | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detailRetry, setDetailRetry] = useState(0);
  const [setupAuth, setSetupAuth] = useState<'subscription' | 'key' | 'later' | null>(draft?.apiKey || draft?.config ? 'key' : null);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetail(null);
    setDetailState('loading');
    let cancelled = false;
    api.getAgentCatalogDetail(selected)
      .then((d) => {
        if (!cancelled) { setDetail(d); setDetailState('ready'); }
      })
      .catch(() => { if (!cancelled) { setDetail(null); setDetailState('error'); } });
    return () => { cancelled = true; };
  }, [selected, api, detailRetry]);

  // Fixed model dropdown (agents tied to one provider). Exclude image/audio.
  const modelOptions = useMemo(() => {
    const models = (detail?.models || [])
      .filter((m) => m.category !== 'image' && m.category !== 'audio')
      .map((m) => ({ id: m.id, label: m.label }));
    return models.length ? models : undefined;
  }, [detail]);

  // Bring-your-own-provider agents (OpenCode, OpenClaw, Cursor, Pi…): no fixed
  // model list, but a generic LLM_* env mapping — the form offers the
  // workspace's saved Model access entries (settings → Model access), loads
  // the models that key can use, and validates live. The browser only ever
  // sends the entry id; the backend resolves the key when enqueuing.
  // Curated models and BYOK are not mutually exclusive: an agent can ship a
  // first-party model list (e.g. OpenCode Zen) AND accept any provider via
  // LLM_* mapping — so gate the Model-access section on the mapping alone.
  // provider_locked agents (Cursor) are the exception: their key field is for
  // the vendor's OWN key only, so offering provider/relay accesses just sets
  // users up for a CLI that can never authenticate.
  const byok = !extensions?.configuration && !!detail?.resolve_env?.rules?.length && !detail?.provider_locked;
  // An agent whose credential is its own, not an LLM_* key the daemon maps
  // (CodeArts: a Huawei Cloud AK/SK pair). The generic "API key" box wrote
  // LLM_API_KEY, which such an agent never reads — so the form asks for the
  // registry's own fields instead and sends them as `config`, which the daemon
  // accepts only for keys the registry declares.
  const nativeCreds = useMemo(
    () => (extensions?.configuration || detail?.resolve_env?.rules?.length
      ? []
      : (detail?.env_config || []).filter((f) => f.password && f.required && !f.name.startsWith('LLM_'))),
    [detail, extensions?.configuration],
  );
  const [nativeValues, setNativeValues] = useState<Record<string, string>>(draft?.config ?? {});
  // Picking another type starts these empty; a retry opens with its own.
  const nativeValuesFor = useRef(selected);
  useEffect(() => {
    if (nativeValuesFor.current === selected) return;
    nativeValuesFor.current = selected;
    setNativeValues({});
  }, [selected]);
  const byokProtocol = detail?.protocol || 'openai';
  const byokState = useByokModels({ api, byok: byok && !guided, protocol: byokProtocol, draft: guided ? undefined : draft, model, setModel });
  const creds = useAgentCredentials({
    node, editAgent, editOnKey, detail, selected, runtimeByType, byok,
    accessId: byokState.accessId, apiKey, model, baseUrl, modelOptions,
    configured: !!extensions?.configuration,
  });

  // A model the form cannot save without is reported under the model field,
  // which takes focus, rather than on the line beside the buttons.
  const [modelError, setModelError] = useState<string | null>(null);
  const modelFieldRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setModelError(null); }, [model, selected, baseUrl, byok]);
  const failModel = (message: string) => {
    // No model field on screen yet (the key's model list is still loading):
    // the form-wide line is the only place left to say it.
    if (!modelFieldRef.current) { setError(message); return; }
    setModelError(message);
    requestAnimationFrame(() => {
      const field = modelFieldRef.current?.querySelector<HTMLElement>('input, button');
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field?.focus({ preventScroll: true });
    });
  };

  const pick = (typeName: string) => {
    setSelected(typeName);
    setSetupAuth(null);
    if (nameTouchedFor.current !== typeName) {
      nameTouchedFor.current = null;
      setName(uniqueAgentName(defaultAgentNameBase(typeName), takenNames));
    }
    setWorkingDir('');
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setCustomModel(false);
    setShowCreds(runtimeStatus(runtimeByType[typeName]) === 'needs_login');
    creds.setUseDeviceKey(null);
    creds.setSignInPick(null);
    creds.setCredsTouched(false);
    byokState.setAccessId('');
    byokState.resetChecks();
  };

  const backToSelection = () => {
    setSelected(null);
    setShowCreds(false);
  };

  return {
    isEdit, takenNames, startType, selected, selectedEntry, selectedStatus, editOnKey, signIn,
    name, setName, nameTouchedFor, nameError, setNameError, nameClash,
    displayName, setDisplayName, canRename,
    workingDir, setWorkingDir, showPicker, setShowPicker, showAllSameType, setShowAllSameType,
    apiKey, setApiKey, baseUrl, setBaseUrl, model, setModel, customModel, setCustomModel,
    codexWireApi, setCodexWireApi, showCreds, setShowCreds,
    busy, setBusy, error, setError, marketQuery, setMarketQuery, marketCat, setMarketCat,
    ...detection, detail, detailState, retryDetail: () => setDetailRetry((v) => v + 1), setupAuth, setSetupAuth, modelOptions, byok, nativeCreds, nativeValues, setNativeValues, byokProtocol,
    byokState, creds, modelError, modelFieldRef, failModel, pick, backToSelection,
  };
}

export type AgentSetupForm = ReturnType<typeof useAgentSetupForm>;
