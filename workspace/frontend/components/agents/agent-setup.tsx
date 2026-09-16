'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Check, ExternalLink, Loader2, Key, ChevronRight, RefreshCw, Plus, Folder, CornerLeftUp, Sparkles, Search, ArrowRight, CheckCircle2, Zap, HardDrive } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { AgentIcon } from '@/components/icons/agent-icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AgentCatalogEntry, AgentCatalogDetail, WorkspaceNode, NodeCommand, ModelAccessEntry, ModelProbeResult } from '@/lib/types';
import { joinNodePath } from '@/lib/node-path';

export interface AgentSetupApi {
  getAgentCatalogDetail(type: string): Promise<AgentCatalogDetail>;
  enqueueNodeCommand(nodeId: string, action: string, args: Record<string, unknown>): Promise<{ commandId?: string }>;
  listNodeCommands(nodeId: string): Promise<NodeCommand[]>;
  listModelAccess(): Promise<ModelAccessEntry[]>;
  probeModelAccess(id: string, model?: string): Promise<ModelProbeResult>;
}

export interface AgentSetupExtensions {
  local?: boolean;
  disabled?: boolean;
  configuration?: (props: { type: string; name?: string; onChanged: () => void }) => React.ReactNode;
  workingDirectoryHint?: string;
  workingDirectoryPlaceholder?: string;
  browseFolder?: (current: string) => Promise<string | null>;
  /** Sets an existing agent's display name. Offered only where the host can do it. */
  renameAgent?: (name: string, displayName: string) => Promise<void>;
  modelAccessDialog?: (props: { onClose: () => void; onSaved: (entry: ModelAccessEntry) => void }) => React.ReactNode;
  promo?: (props: { agentType: string; accesses: ModelAccessEntry[] | null; selectedAccessId: string; onUse: (entry: ModelAccessEntry, created: boolean) => void }) => React.ReactNode;
}

const NO_ACCESS = '__none__';
const AUTO_MODEL = '__auto__';
const CUSTOM_MODEL = '__custom__';
const MARKET_POPULAR_AGENTS = ['claude', 'openclaw', 'codex', 'cursor', 'opencode', 'hermes', 'pi', 'kimi', 'deepseek'];

/** Derive the per-type detection status shown as a badge in the gallery. */
function runtimeStatus(rt: import('@/lib/types').NodeRuntime | undefined) {
  if (!rt) return 'unknown' as const;
  if (rt.installed && rt.ready) return 'ready' as const;
  if (rt.installed && !rt.ready) return 'needs_login' as const;
  return 'not_installed' as const;
}

/**
 * Smoke-test panel: the last live "hi"-probe result the daemon reported for
 * this AGENT on this node (probes are per agent — run after create and
 * reconfigure, then hourly), plus a button to run it again (queues a
 * `probe_agent` node command; the fresh result arrives via the heartbeat's
 * agents[].probe on the next poll).
 */
function SmokeTestPanel({ api, nodeId, agentName, probe, onChanged }: {
  api: AgentSetupApi;
  nodeId: string;
  agentName: string;
  probe: import('@/lib/types').NodeProbe | null | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  // Stop the spinner as soon as a fresh result lands (its timestamp changes).
  const lastAt = useRef(probe?.at);
  useEffect(() => {
    if (probe?.at !== lastAt.current) {
      lastAt.current = probe?.at;
      setTesting(false);
    }
  }, [probe?.at]);

  // Static-only results say nothing about liveness — treat as untested.
  const informative = probe && probe.code !== 'static_only' ? probe : null;

  const run = async () => {
    setTesting(true);
    try {
      await api.enqueueNodeCommand(nodeId, 'probe_agent', { name: agentName });
      // Nudge the node poll a few times while the probe runs on the device;
      // a probe can take up to its CLI timeout, so keep the spinner bounded.
      setTimeout(onChanged, 8000);
      setTimeout(onChanged, 20000);
      setTimeout(onChanged, 45000);
      setTimeout(() => setTesting(false), 150000);
    } catch {
      toast.error(t('connect.nodeCommandFailed'));
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 text-xs">
          <span className="font-medium shrink-0">{t('connect.smokeTestTitle')}</span>
          {testing ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />{t('connect.smokeTestRunning')}
            </span>
          ) : informative ? (
            <span className={cn(
              'inline-flex items-center gap-1.5 min-w-0',
              informative.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}>
              {informative.ok ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
              {informative.ok ? t('connect.smokeTestPassed') : t('connect.smokeTestFailed')}
              <span className="text-muted-foreground truncate">
                {t('connect.smokeTestAt', { time: new Date(informative.at).toLocaleString() })}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t('connect.smokeTestNever')}</span>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px] shrink-0" onClick={run} disabled={testing}>
          {informative ? t('connect.smokeTestRerun') : t('connect.smokeTestRun')}
        </Button>
      </div>
      {!testing && informative && !informative.ok && (
        <div className="space-y-1.5">
          {informative.message && (
            <p className="text-[11px] text-red-600/90 dark:text-red-400/90 break-words">{informative.message}</p>
          )}
          {(informative.guidance || []).length > 0 && (
            <ul className="space-y-1">
              {(informative.guidance || []).map((line, i) => (
                <li key={i} className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5">
                  <ArrowRight className="size-3 mt-0.5 shrink-0" />
                  <span className="break-words">{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Marketplace building blocks (Add-agent gallery) ─────────────────────────
// The gallery reads as a storefront: featured spotlight, search + category
// chips, vendor + status-dot cards. The app's `primary` token is near-black,
// so the marketplace carries its own indigo accent in both themes.

type GalleryStatus = ReturnType<typeof runtimeStatus>;

/** Logo chip on a white surface so dark agent marks stay legible in dark mode. */
function MarketLogo({ name, size, className }: { name: string; size: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10 shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <AgentIcon name={name} size={Math.round(size * 0.55)} />
    </span>
  );
}

function marketStatusMeta(t: ReturnType<typeof useT>, status: GalleryStatus) {
  switch (status) {
    case 'ready':
      return { label: t('connect.nodeRuntimeReady'), dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
    case 'needs_login':
      return { label: t('connect.nodeRuntimeNeedsLogin'), dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' };
    default:
      return { label: t('connect.nodeRuntimeWillInstall'), dot: 'bg-zinc-400', text: 'text-muted-foreground' };
  }
}

function MarketStatusBadge({ status, checking, className }: { status: GalleryStatus; checking?: boolean; className?: string }) {
  const t = useT();
  if (checking) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[10.5px] font-medium text-primary whitespace-nowrap', className)}>
        <Loader2 className="size-2.5 animate-spin" />{t('connect.nodeChecking')}
      </span>
    );
  }
  const meta = marketStatusMeta(t, status);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[10.5px] font-medium whitespace-nowrap', meta.text, className)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

/** Rotating featured spotlight above the marketplace grid. */
function MarketHero({ slides, statusOf, checkingOf, onPick }: {
  slides: AgentCatalogEntry[];
  statusOf: (name: string) => GalleryStatus;
  checkingOf: (name: string) => boolean;
  onPick: (name: string) => void;
}) {
  const t = useT();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => setI((v) => (v + 1) % slides.length), 6000);
    return () => clearInterval(timer);
  }, [slides.length]);
  const a = slides[i % slides.length];
  if (!a) return null;
  const status = statusOf(a.name);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-500/25 bg-gradient-to-r from-indigo-500/[0.09] via-violet-500/[0.05] to-transparent dark:from-indigo-400/[0.12] dark:via-violet-400/[0.05]">
      <div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-0 size-72 rounded-full bg-violet-500/15 blur-3xl" />

      <div key={a.name} className="relative flex items-center gap-5 px-5 py-5 sm:px-7 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <MarketLogo name={a.name} size={76} className="rounded-2xl shadow-md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">
            <Sparkles className="size-3" /> {t('connect.marketFeatured')}
          </div>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight truncate">{a.label}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground max-w-lg line-clamp-2">{a.tagline || a.description}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={() => onPick(a.name)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-500 transition-colors"
            >
              <Plus className="size-3.5" /> {t('connect.marketAddToDevice')}
            </button>
            <MarketStatusBadge status={status} checking={checkingOf(a.name)} className="hidden sm:inline-flex" />
          </div>
        </div>
        <div className="hidden lg:flex flex-col gap-1.5 w-44 shrink-0">
          {[
            [t('connect.marketVendor'), a.vendor || '—'],
            [t('connect.marketRuntime'), t('connect.marketRuntimeValue')],
            [t('connect.marketOnDevice'), marketStatusMeta(t, status).label],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-background/70 backdrop-blur-sm ring-1 ring-border/60 px-3 py-1.5">
              <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">{k}</div>
              <div className="text-[11.5px] font-medium truncate">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex items-center gap-1.5 px-5 sm:px-7 pb-3.5">
        {slides.map((s, idx) => (
          <button
            key={s.name}
            onClick={() => setI(idx)}
            aria-label={s.label}
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              idx === i % slides.length ? 'w-6 bg-indigo-500' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
            )}
          />
        ))}
      </div>
    </div>
  );
}

// Model options come from GET /v1/agent-catalog/{type} — the registry resolves
// each agent's supported models server-side, so the dropdown is always current
// with no per-type mapping in the client. Agents whose detail returns an empty
// model list use their own login/default and show no model field. Cached per
// type for the page's lifetime (the list only changes on backend deploys).


/**
 * Browse folders on the *node's* filesystem to pick a working directory. The
 * home level shows instantly from the node's heartbeat snapshot; drilling
 * deeper runs a list_dir command on the device (a short wait).
 */
function FolderPicker({
  api,
  node,
  onPick,
  onClose,
}: {
  api: AgentSetupApi;
  node: WorkspaceNode;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const home = node.fs?.home || null;
  const roots = node.fs?.roots || [];
  const [path, setPath] = useState<string | null>(home);
  const [dirs, setDirs] = useState<string[]>(node.fs?.dirs || []);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(!home);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const browse = async (target: string) => {
    setLoading(true);
    try {
      const cmd = await api.enqueueNodeCommand(node.nodeId, 'list_dir', { path: target });
      for (let i = 0; i < 20 && !cancelled.current; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const cmds = await api.listNodeCommands(node.nodeId).catch(() => []);
        const c = cmds.find((x) => x.commandId === cmd.commandId);
        if (c && (c.status === 'done' || c.status === 'error')) {
          if (cancelled.current) return;
          const data = c.result?.data as { path: string; parent: string | null; dirs: string[] } | undefined;
          if (c.status === 'done' && data) {
            setPath(data.path); setDirs(data.dirs || []); setParent(data.parent); setUnavailable(false);
          } else {
            setUnavailable(true);
          }
          setLoading(false);
          return;
        }
      }
      if (!cancelled.current) setLoading(false);
    } catch {
      if (!cancelled.current) { setLoading(false); setUnavailable(true); }
    }
  };

  return (
    <div className="rounded-xl border bg-background overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 bg-muted/40">
        <span className="text-[11px] font-medium truncate">{t('connect.nodePickerTitle')}</span>
        <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>

      {/* Current path */}
      <div className="px-3 py-2 border-b bg-zinc-950 dark:bg-black">
        <code className="text-[11px] font-mono text-zinc-100 break-all">{path || '—'}</code>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /><span className="text-xs">{t('connect.nodePickerLoading')}</span>
          </div>
        ) : unavailable ? (
          <p className="text-[11px] text-muted-foreground px-3 py-6 text-center">{t('connect.nodePickerUnavailable')}</p>
        ) : (
          <div className="py-1">
            {roots.length > 0 && (
              <div className="px-3 py-2 border-b mb-1">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  {t('connect.nodePickerLocations')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {roots.map((root) => (
                    <button
                      key={root}
                      onClick={() => browse(root)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono transition-colors hover:bg-muted/60',
                        path === root && 'bg-muted border-foreground/20',
                      )}
                    >
                      <HardDrive className="size-3.5 text-muted-foreground" />{root}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {parent && (
              <button
                onClick={() => browse(parent)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 transition-colors"
              >
                <CornerLeftUp className="size-4 text-muted-foreground" />{t('connect.nodePickerUp')}
              </button>
            )}
            {dirs.length === 0 && !parent ? (
              <p className="text-[11px] text-muted-foreground px-3 py-6 text-center">{t('connect.nodePickerEmpty')}</p>
            ) : (
              dirs.map((d) => (
                <button
                  key={d}
                  onClick={() => path && browse(joinNodePath(path, d))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 transition-colors"
                >
                  <Folder className="size-4 text-blue-500" /><span className="truncate">{d}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>{t('connect.nodeCancel')}</Button>
        <Button size="sm" variant="primary" disabled={!path} onClick={() => { if (path) { onPick(path); onClose(); } }}>
          {t('connect.nodePickerUseThis')}
        </Button>
      </div>
    </div>
  );
}

export function AgentSetup({
  node,
  catalog,
  api,
  extensions,
  contextLabel,
  editAgent,
  onManageAgent,
  onBack,
  onChanged,
  onQueued,
}: {
  node: WorkspaceNode;
  catalog: AgentCatalogEntry[];
  api: AgentSetupApi;
  extensions?: AgentSetupExtensions;
  contextLabel?: React.ReactNode;
  editAgent?: import('@/lib/types').NodeAgent;
  onManageAgent?: (agent: import('@/lib/types').NodeAgent) => void;
  onBack: () => void;
  onChanged: () => void;
  onQueued?: (agent: { name: string; type: string; commandId?: string }) => void;
}) {
  const t = useT();
  const isEdit = !!editAgent;
  const [selected, setSelected] = useState<string | null>(editAgent?.type ?? null);
  const [name, setName] = useState(editAgent?.name ?? '');
  // The label people see, editable after creation — unlike `name`, which is the
  // agent's identity (config, env files, @mentions) and stays fixed.
  const [displayName, setDisplayName] = useState(editAgent?.displayName ?? '');
  const canRename = isEdit && !!extensions?.renameAgent;
  // Once the user edits the name, picking/switching a type must never overwrite
  // it — otherwise a typed name like "claudecbd" silently reverts to the type
  // ("claude"). The type only seeds the name as a convenience default.
  const nameTouched = useRef(false);
  const [workingDir, setWorkingDir] = useState(editAgent?.workingDir ?? '');
  const [apiKey, setApiKey] = useState('');
  // Custom OpenAI/Anthropic-compatible endpoint. Without this field a key was
  // only usable against an agent's built-in providers — for hermes (whose key
  // is meaningless without an endpoint) the form was a dead end. The daemon's
  // create/configure commands have always accepted baseUrl; the form just
  // never sent it.
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState(editAgent?.model ?? '');
  // When editing an agent that has a key on the node, open the credentials
  // section up front so the masked key (and the keep-if-blank rule) is visible
  // — otherwise the collapsed section reads as "no key saved".
  const [showCreds, setShowCreds] = useState(!!editAgent?.apiKeyMasked);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Marketplace toolbar state (selection mode).
  const [marketQuery, setMarketQuery] = useState('');
  const [marketCat, setMarketCat] = useState('all');
  // Detection is "in progress" until the node reports its runtime list — either
  // on first open (nothing reported yet) or after a Re-detect, until fresh data
  // arrives on the next heartbeat.
  const hasRuntimes = (node.runtimes || []).length > 0;
  const [detecting, setDetecting] = useState(!hasRuntimes);

  const runtimeByType = useMemo(() => {
    const m: Record<string, import('@/lib/types').NodeRuntime> = {};
    for (const r of node.runtimes || []) m[r.type] = r;
    return m;
  }, [node.runtimes]);

  // Clear "detecting" as soon as the runtime snapshot arrives or changes.
  const runtimesSig = (node.runtimes || []).map((r) => `${r.type}:${r.installed}:${r.ready}:${r.probe?.at ?? ''}`).join('|');
  const prevSigRef = useRef(runtimesSig);
  useEffect(() => {
    if (runtimesSig !== prevSigRef.current) {
      prevSigRef.current = runtimesSig;
      setDetecting(false);
    }
  }, [runtimesSig]);

  const selectedEntry = catalog.find((e) => e.name === selected);
  const selectedStatus = runtimeStatus(selected ? runtimeByType[selected] : undefined);

  const pick = (typeName: string) => {
    setSelected(typeName);
    if (!nameTouched.current) setName(typeName); // seed only while untouched
    setWorkingDir('');
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setShowCreds(runtimeStatus(runtimeByType[typeName]) === 'needs_login');
    setByokAccessId('');
    resetByokChecks();
  };

  const backToSelection = () => {
    setSelected(null);
    setShowCreds(false);
  };

  // Registry detail for the selected type: fixed model list (claude/gemini/…)
  // and whether the agent is bring-your-own-provider (generic LLM_* mapping).
  const [detail, setDetail] = useState<import('@/lib/types').AgentCatalogDetail | null>(
    null,
  );
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetail(null);
    let cancelled = false;
    api.getAgentCatalogDetail(selected)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selected, api]);

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
  const [nativeValues, setNativeValues] = useState<Record<string, string>>({});
  useEffect(() => { setNativeValues({}); }, [selected]);
  // Anthropic-protocol agents (Claude family) can only use Anthropic keys or
  // Anthropic-compatible relays — filter the saved accesses accordingly.
  const byokProtocol = detail?.protocol || 'openai';
  const [accesses, setAccesses] = useState<import('@/lib/types').ModelAccessEntry[] | null>(null);
  const byokAccessOptions = (accesses || []).filter((a) =>
    byokProtocol === 'anthropic'
      ? ['anthropic', 'custom-anthropic'].includes(a.provider)
      : a.provider !== 'custom-anthropic',
  );
  const [byokAccessId, setByokAccessId] = useState('');
  const [byokCustomModel, setByokCustomModel] = useState(false);
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const [byokModels, setByokModels] = useState<{ id: string; label: string }[] | null>(null);
  const [byokModelsSource, setByokModelsSource] = useState<'live' | 'catalog' | null>(null);
  const [byokLoading, setByokLoading] = useState(false);
  const [byokKeyError, setByokKeyError] = useState<string | null>(null);
  const [byokTest, setByokTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; ms?: number; error?: string }>({ state: 'idle' });

  useEffect(() => {
    if (!byok || accesses !== null) return;
    api.listModelAccess().then(setAccesses).catch(() => setAccesses([]));
  }, [byok, accesses]);

  const resetByokChecks = () => {
    setByokModels(null); setByokModelsSource(null); setByokKeyError(null); setByokTest({ state: 'idle' });
  };

  const loadByokModels = async (accessId: string) => {
    if (!accessId) return;
    setByokLoading(true); setByokKeyError(null); setByokTest({ state: 'idle' });
    try {
      const r = await api.probeModelAccess(accessId);
      if (r.keyOk === false) {
        setByokKeyError(r.error || t('connect.byokKeyInvalid'));
        setByokModels(null);
      } else {
        const models = (r.models || [])
          .filter((m) => m.category !== 'image' && m.category !== 'audio')
          .map((m) => ({ id: m.id, label: m.label }))
          // Providers return /models in arbitrary order — sort by name so the
          // dropdown is scannable. numeric:true keeps version numbers sane
          // (gpt-4 < gpt-5.1 < gpt-5.6, qwen-1.8b < qwen3.5).
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
        setByokModels(models);
        setByokModelsSource(r.source || 'live');
      }
    } catch (err) {
      setByokKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setByokLoading(false);
    }
  };

  const pickAccess = (accessId: string) => {
    setByokAccessId(accessId);
    setModel('');
    setByokCustomModel(false);
    resetByokChecks();
    if (accessId) loadByokModels(accessId);
  };

  const testByok = async () => {
    if (!byokAccessId || !model.trim()) return;
    setByokTest({ state: 'testing' });
    try {
      const r = await api.probeModelAccess(byokAccessId, model.trim());
      if (r.ok) setByokTest({ state: 'ok', ms: r.latencyMs });
      else setByokTest({ state: 'fail', error: r.error });
    } catch (err) {
      setByokTest({ state: 'fail', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const reDetect = async () => {
    setDetecting(true);
    try {
      await api.enqueueNodeCommand(node.nodeId, 'detect_runtimes', {});
      setTimeout(onChanged, 4000);
      // Safety: if fresh data never arrives, stop the spinner after a while so
      // the UI doesn't look stuck.
      setTimeout(() => setDetecting(false), 20000);
    } catch {
      toast.error(t('connect.nodeCommandFailed'));
      setDetecting(false);
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n || !selected || submitting.current) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(n)) { setError(t('connect.agentNameInvalid')); return; }
    if (!isEdit && node.agents.some((agent) => agent.name === n)) { setError(t('connect.agentNameExists')); return; }
    // A device that already holds them (configured there) needs nothing from
    // here; otherwise a new agent cannot start without every one of them.
    const nativeConfig = Object.fromEntries(
      nativeCreds.map((f) => [f.name, (nativeValues[f.name] || '').trim()]).filter(([, v]) => v),
    );
    const missingNative = nativeCreds.find((f) => !nativeConfig[f.name]);
    if (!isEdit && selectedStatus !== 'ready' && missingNative) {
      setError(t('connect.nodeNativeCredRequired', { field: missingNative.name }));
      return;
    }
    const configArg = Object.keys(nativeConfig).length ? { config: nativeConfig } : {};
    submitting.current = true;
    setError(null);
    setBusy(true);
    try {
      if (isEdit) {
        await api.enqueueNodeCommand(node.nodeId, 'configure_agent', {
          name: n,
          type: selected,
          model: model.trim(),                       // '' clears → Auto
          currentWorkingDir: editAgent?.workingDir || '',
          ...(workingDir.trim() ? { workingDir: workingDir.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrl.trim() && !detail?.provider_locked ? { baseUrl: baseUrl.trim() } : {}),
          ...(byok && byokAccessId ? { modelAccessId: byokAccessId } : {}),
          ...configArg,
        });
        // After the configuration, so a label the workspace refuses (too long,
        // taken by another agent) never costs the settings saved above.
        const label = displayName.trim();
        if (canRename && label !== (editAgent?.displayName ?? '').trim()) {
          await extensions!.renameAgent!(n, label);
        }
      } else {
        const cmd = await api.enqueueNodeCommand(node.nodeId, 'create_agent', {
          name: n,
          type: selected,
          ...(workingDir.trim() ? { workingDir: workingDir.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrl.trim() && !detail?.provider_locked ? { baseUrl: baseUrl.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(byok && byokAccessId ? { modelAccessId: byokAccessId } : {}),
          ...configArg,
        });
        // Optimistically show it spinning up in the node card. The commandId
        // lets the placeholder track the REAL install/config progress instead
        // of guessing from a timer.
        onQueued?.({ name: n, type: selected, commandId: cmd?.commandId });
      }
      toast.success(extensions?.local ? t(isEdit ? 'connect.agentSaved' : 'connect.agentAdded') : t('connect.nodeCommandQueued', { node: node.name }));
      if (extensions?.local) onChanged();
      else setTimeout(onChanged, 3000);
      onBack();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(/40[13]/.test(msg) ? t('connect.nodeCommandForbidden') : msg || t('connect.nodeCommandFailed'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const badge = (status: ReturnType<typeof runtimeStatus>) => {
    const map = {
      ready: { label: t('connect.nodeRuntimeReady'), cls: 'bg-green-500/10 text-green-600 dark:text-green-400' },
      needs_login: { label: t('connect.nodeRuntimeNeedsLogin'), cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-500' },
      not_installed: { label: t('connect.nodeRuntimeWillInstall'), cls: 'bg-zinc-500/10 text-muted-foreground' },
      unknown: { label: '', cls: '' },
    } as const;
    const b = map[status];
    if (!b.label) return null;
    return <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded-full', b.cls)}>{b.label}</span>;
  };

  // ---- Config mode: a focused, full-view form for the chosen agent ----------
  if (selectedEntry) {
    // Three bands: which agent this is (fixed), the form (the only part that
    // scrolls) and the actions (fixed). On one long scrolling page a long form
    // carried the agent it configured, and its Save button, out of sight.
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <header className="shrink-0 border-b">
          <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-4 sm:px-6">
            <div className="text-xs text-muted-foreground">{contextLabel || t('connect.agentRunsOn', { device: node.name })}</div>

            {/* Agent hero */}
            <div className="flex items-center gap-4">
              <div className="size-14 shrink-0 rounded-2xl border bg-muted/40 flex items-center justify-center shadow-sm">
                <AgentIcon name={selectedEntry.name} size={34} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold truncate">{isEdit ? t('connect.agentConfigure', { name: editAgent!.name }) : selectedEntry.label}</h3>
                  {badge(selectedStatus)}
                  {selectedEntry.homepage && (
                    <a href={selectedEntry.homepage} target="_blank" rel="noopener noreferrer"
                       className="text-muted-foreground/50 hover:text-primary transition-colors"><ExternalLink className="size-3.5" /></a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{selectedEntry.description}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 sm:px-6">
        {!isEdit && onManageAgent && node.agents.some((agent) => agent.type === selected) && (
          <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-medium">{t('connect.agentAlreadyHere')}</p>
            {node.agents.filter((agent) => agent.type === selected).map((agent) => (
              <button key={agent.name} disabled={busy} onClick={() => onManageAgent(agent)} className="flex w-full items-center justify-between gap-3 text-sm text-left py-1">
                <span className="truncate">{agent.name}</span><span className="shrink-0 text-primary">{t('connect.agentOpenExisting')} →</span>
              </button>
            ))}
          </div>
        )}

        {/* Config card */}
        <fieldset disabled={busy} className="rounded-2xl border bg-background p-5 space-y-4 min-w-0">
          {/* Status hint */}
          {!extensions?.configuration && <div className={cn(
            'text-xs rounded-xl px-4 py-3 leading-relaxed',
            selectedStatus === 'ready' && 'bg-green-500/10 text-green-700 dark:text-green-400',
            selectedStatus === 'needs_login' && 'bg-amber-500/10 text-amber-700 dark:text-amber-500',
            (selectedStatus === 'not_installed' || selectedStatus === 'unknown') && 'bg-muted text-muted-foreground',
          )}>
            {selectedStatus === 'ready' && t('connect.nodeReadyHint')}
            {selectedStatus === 'needs_login' && (detail?.provider_locked
              ? t('connect.nodeProviderLockedHint', { label: selectedEntry?.label || selected || '' })
              : t('connect.nodeNeedsLoginHint'))}
            {(selectedStatus === 'not_installed' || selectedStatus === 'unknown') && t('connect.nodeWillInstallHint')}
          </div>}

          {/* Provider-locked agents (Cursor): the ONLY credentials that work are
              the vendor's own — spell out both paths so the key field isn't a
              guessing game, and nobody pastes an OpenAI/relay key that can
              never authenticate. */}
          {detail?.provider_locked && selectedStatus !== 'ready' && (
            <div className="text-xs rounded-xl border px-4 py-3 leading-relaxed space-y-2">
              <p className="font-medium">{t('connect.nodeProviderLockedHow', { label: selectedEntry?.label || selected || '' })}</p>
              {detail?.check_ready?.login_command && (
                <p className="text-muted-foreground">
                  {t('connect.nodeProviderLockedLogin')}{' '}
                  <code className="font-mono bg-muted rounded px-1.5 py-0.5">{detail.check_ready.login_command}</code>
                </p>
              )}
              <p className="text-muted-foreground">
                {t('connect.nodeProviderLockedKey', { label: selectedEntry?.label || selected || '' })}
                {selectedEntry?.homepage && (
                  <>
                    {' '}
                    <a href={selectedEntry.homepage} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                      {selectedEntry.homepage.replace(/^https?:\/\//, '')}
                    </a>
                  </>
                )}
              </p>
            </div>
          )}

          {/* Smoke test — per AGENT, so it only exists once the agent does
              (probes run automatically after create/reconfigure and hourly;
              nothing is probed for a bare agent type). */}
          {isEdit && editAgent && !extensions?.configuration && (
            <SmokeTestPanel api={api}
              nodeId={node.nodeId}
              agentName={editAgent.name}
              probe={(node.agents || []).find((a) => a.name === editAgent.name)?.probe}
              onChanged={onChanged}
            />
          )}

          {/* Display name — the label, editable where the host can rename. */}
          {canRename && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('connect.agentDisplayNameLabel')}</Label>
              <Input aria-label={t('connect.agentDisplayNameLabel')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={editAgent!.name} maxLength={64} className="h-10 text-sm" />
              <p className="text-[11px] text-muted-foreground">{t('connect.agentDisplayNameHint')}</p>
            </div>
          )}

          {/* Name (fixed when editing an existing agent) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('connect.nodeAgentNameLabel')}</Label>
            <Input aria-label={t('connect.nodeAgentNameLabel')} value={name} onChange={(e) => { setName(e.target.value); nameTouched.current = true; }} placeholder={t('connect.nodeAgentNamePlaceholder')} className="h-10 text-sm" disabled={isEdit} />
            {canRename && <p className="text-[11px] text-muted-foreground">{t('connect.agentNameFixedHint')}</p>}
          </div>

          {selected && extensions?.configuration?.({ type: selected, name: editAgent?.name, onChanged })}

          {/* Bring-your-own-provider: saved model access → model, live-verified */}
          {byok && (
            <div className="space-y-3 rounded-xl border border-indigo-500/25 bg-gradient-to-b from-indigo-500/[0.05] to-transparent p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                  <Key className="size-3.5 text-indigo-500" />{t('connect.byokTitle')}
                </span>
                {byokTest.state === 'ok' && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />{t('connect.byokVerifiedShort')}
                  </span>
                )}
              </div>

              {/* Saved model access + add-new */}
              <div className="flex gap-2">
                <Select
                  value={byokAccessId || NO_ACCESS}
                  onValueChange={(v) => pickAccess(v === NO_ACCESS ? '' : v)}
                >
                  <SelectTrigger className="h-10 min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCESS}>{t('connect.byokProviderNone')}</SelectItem>
                    {byokAccessOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label} · {a.apiKeyMasked}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setShowAccessDialog(true)} className="h-10 shrink-0">
                  <Plus className="size-3.5 mr-1.5" />{t('connect.byokAddAccess')}
                </Button>
              </div>

              {/* One-click promo credits — OpenAI-protocol agents the campaign
                  gateway can back. Selects (or creates) the gateway access. */}
              {selected && byokProtocol !== 'anthropic' && extensions?.promo?.({
                agentType: selected, accesses, selectedAccessId: byokAccessId,
                onUse: (entry, created) => {
                  if (created) setAccesses((prev) => [entry, ...(prev || [])]);
                  pickAccess(entry.id);
                },
              })}

              {accesses !== null && accesses.length === 0 && !byokAccessId && (
                <p className="text-[11px] text-muted-foreground">{t('connect.byokNoAccessHint')}</p>
              )}

              {byokAccessId && (
                <>
                  {byokLoading && (
                    <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />{t('connect.byokLoadingModels')}
                    </p>
                  )}
                  {byokKeyError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">{byokKeyError}</p>
                  )}

                  {/* Model — the ones this key can actually use */}
                  {byokModels && (
                    <div className="space-y-1.5">
                      <Select
                        value={byokCustomModel ? CUSTOM_MODEL : model || undefined}
                        onValueChange={(v) => {
                          if (v === CUSTOM_MODEL) { setByokCustomModel(true); setModel(''); }
                          else { setByokCustomModel(false); setModel(v); }
                          setByokTest({ state: 'idle' });
                        }}
                      >
                        <SelectTrigger className="h-10 w-full">
                          <SelectValue placeholder={t('connect.byokChooseModel')} />
                        </SelectTrigger>
                        <SelectContent>
                          {byokModels.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_MODEL}>
                            {t('connect.byokCustomModel')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {byokCustomModel && (
                        <Input
                          value={model}
                          onChange={(e) => { setModel(e.target.value); setByokTest({ state: 'idle' }); }}
                          placeholder="claude-sonnet-4-6"
                          className="h-10 text-sm font-mono"
                        />
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {byokModelsSource === 'live'
                          ? t('connect.byokModelsLive', { count: byokModels.length })
                          : t('connect.byokModelsCatalog')}
                      </p>
                    </div>
                  )}

                  {/* Live validation before adding */}
                  <div className="flex items-start gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testByok}
                      disabled={!model.trim() || byokTest.state === 'testing'}
                      className="shrink-0"
                    >
                      {byokTest.state === 'testing'
                        ? (<><Loader2 className="size-3.5 mr-1.5 animate-spin" />{t('connect.byokTesting')}</>)
                        : (<><Zap className="size-3.5 mr-1.5" />{t('connect.byokTest')}</>)}
                    </Button>
                    {byokTest.state === 'ok' && (
                      <span className="text-[11px] leading-relaxed text-emerald-600 dark:text-emerald-400 pt-1.5">
                        {t('connect.byokTestOk', { model: model.trim(), ms: byokTest.ms ?? 0 })}
                      </span>
                    )}
                    {byokTest.state === 'fail' && (
                      <span className="text-[11px] leading-relaxed text-red-600 dark:text-red-400 pt-1.5">
                        {t('connect.byokTestFail')}{byokTest.error ? ` — ${byokTest.error}` : ''}
                      </span>
                    )}
                  </div>
                </>
              )}

              {showAccessDialog && extensions?.modelAccessDialog?.({
                onClose: () => setShowAccessDialog(false),
                onSaved: (entry) => {
                  setShowAccessDialog(false);
                  setAccesses((prev) => [entry, ...(prev || [])]);
                  pickAccess(entry.id);
                },
              })}
            </div>
          )}

          {/* Model — curated dropdown; hidden while a saved model access is
              driving the list (its live models replace the curated set). */}
          {!extensions?.configuration && modelOptions && !(byok && byokAccessId) && !baseUrl.trim() && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('connect.nodeModel')}</Label>
              <Select
                value={model || AUTO_MODEL}
                onValueChange={(v) => setModel(v === AUTO_MODEL ? '' : v)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_MODEL}>{t('connect.nodeModelAuto')}</SelectItem>
                  {modelOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Working directory — optional, managed default, with a folder picker */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('connect.nodeWorkingDirOptional')}</Label>
            <div className="flex gap-2">
              <Input aria-label={t('connect.nodeWorkingDirOptional')} value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder={extensions?.workingDirectoryPlaceholder || t('connect.nodeWorkingDirPlaceholder')} className="h-10 text-sm font-mono flex-1" />
              <Button variant="outline" onClick={() => { if (extensions?.browseFolder) { void extensions.browseFolder(workingDir).then((path) => { if (path) setWorkingDir(path); }).catch((err) => toast.error(String(err))); } else setShowPicker((v) => !v); }} className="h-10 shrink-0">
                <Folder className="size-4 mr-1.5" />{t('connect.nodeBrowse')}
              </Button>
            </div>
            {showPicker && (
              <FolderPicker api={api}
                node={node}
                onPick={(p) => setWorkingDir(p)}
                onClose={() => setShowPicker(false)}
              />
            )}
            <p className="text-[11px] text-muted-foreground">{extensions?.workingDirectoryHint || t('connect.nodeWorkingDirHint')}</p>
          </div>

          {/* Credentials — optional (BYOK agents configure them above instead) */}
          {!extensions?.configuration && !byok && nativeCreds.length > 0 ? (
            <div className="space-y-3">
              {nativeCreds.map((f) => (
                <div key={f.name} className="space-y-1.5">
                  <Label className="text-xs font-medium font-mono">
                    {f.name}{!isEdit && selectedStatus !== 'ready' && <span className="text-destructive"> *</span>}
                  </Label>
                  <Input
                    aria-label={f.name}
                    value={nativeValues[f.name] || ''}
                    onChange={(e) => setNativeValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    type="password"
                    autoComplete="off"
                    className="h-10 text-sm"
                  />
                  {f.description && <p className="text-[11px] text-muted-foreground">{f.description}</p>}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">{t('connect.nodeNativeCredsHint')}</p>
              {!modelOptions && (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connect.nodeAgentModelOptional')} className="h-10 text-sm" />
              )}
            </div>
          ) : extensions?.configuration ? null : byok ? null : !showCreds ? (
            <button onClick={() => setShowCreds(true)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <Key className="size-3.5" />{t('connect.nodeCredsOptional')}
            </button>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs font-medium">{t('connect.nodeCredsOptional')}</Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isEdit && editAgent?.apiKeyMasked ? editAgent.apiKeyMasked : t('connect.nodeAgentKeyOptional')}
                type="password"
                className="h-10 text-sm"
              />
              {isEdit && editAgent?.apiKeyMasked && (
                <p className="text-[11px] text-muted-foreground">
                  {t('connect.nodeKeyConfiguredHint', { masked: editAgent.apiKeyMasked })}
                </p>
              )}
              {/* No custom endpoint for provider-locked agents — as dead an
                  option as a relay key. */}
              {!detail?.provider_locked && (
                <>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={t('connect.nodeAgentBaseUrlOptional')}
                    className="h-10 text-sm font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">{t('connect.nodeAgentBaseUrlHint')}</p>
                </>
              )}
              {/* Custom endpoint set → the curated model ids don't apply; take
                  the endpoint's own model id as free text instead. */}
              {(!modelOptions || !!baseUrl.trim()) && (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connect.nodeAgentModelOptional')} className="h-10 text-sm" />
              )}
            </div>
          )}

        </fieldset>
        </div>
        </div>

        {/* Back and Save stay on screen however long the form is. Back replaces
            the old Cancel beside Save: both only ever left the form. */}
        <footer className="shrink-0 border-t bg-background">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
            <Button variant="ghost" onClick={isEdit ? onBack : backToSelection} disabled={busy} className="shrink-0">
              <ChevronRight className="size-4 mr-1 rotate-180" />{isEdit ? t('connect.nodeBack') : t('connect.nodeBackToAgents')}
            </Button>
            {error
              ? <p role="alert" className="min-w-0 flex-1 line-clamp-2 text-sm text-destructive">{error}</p>
              : <div className="flex-1" />}
            <Button variant="primary" onClick={create} disabled={busy || !name.trim() || extensions?.disabled} className="shrink-0">
              {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Plus className="size-4 mr-1.5" />}
              {isEdit ? t('connect.nodeSaveChanges') : t('connect.agentAddTitle')}
            </Button>
          </div>
        </footer>
      </div>
    );
  }

  // ---- Selection mode: the agent marketplace --------------------------------
  const statusOf = (name: string) => runtimeStatus(runtimeByType[name]);
  const checkingOf = (name: string) => detecting && !runtimeByType[name];
  const featured = catalog.filter((e) => e.featured);
  const readyCount = catalog.filter((e) => {
    const s = statusOf(e.name);
    return s === 'ready' || s === 'needs_login';
  }).length;

  const marketCats = [
    { key: 'all', label: t('connect.marketCatAll') },
    { key: 'ready', label: t('connect.marketCatReady') },
    { key: 'open-source', label: t('connect.marketCatOpenSource') },
    { key: 'cli', label: t('connect.marketCatTerminal') },
    { key: 'editor', label: t('connect.marketCatIde') },
  ];
  const q = marketQuery.trim().toLowerCase();
  const visible = catalog.filter((e) => {
    const s = statusOf(e.name);
    const tags = e.tags || [];
    if (marketCat === 'ready' && s !== 'ready' && s !== 'needs_login') return false;
    if (marketCat === 'open-source' && !tags.includes('open-source')) return false;
    if (marketCat === 'cli' && !(tags.includes('cli') || tags.includes('terminal'))) return false;
    if (marketCat === 'editor' && !(tags.includes('editor') || tags.includes('vscode') || tags.includes('ide-extension'))) return false;
    if (!q) return true;
    return [e.name, e.label, e.vendor || '', e.description, ...tags].join(' ').toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-start gap-2">
        <button
          onClick={onBack}
          className="shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('connect.nodeBack')}
        >
          <ChevronRight className="size-4 rotate-180" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold tracking-tight">{t('connect.agentAddTitle')}</h3>
          <div className="text-xs text-muted-foreground mt-1">{contextLabel || t('connect.agentRunsOn', { device: node.name })}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {detecting
              ? t('connect.nodeDetectingAgents')
              : t('connect.marketSummary', { count: catalog.length, ready: readyCount })}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reDetect} disabled={detecting}>
          <RefreshCw className={cn('size-3.5 mr-1', detecting && 'animate-spin')} />
          {detecting ? t('connect.nodeDetecting') : t('connect.nodeReDetect')}
        </Button>
      </div>

      {/* Featured spotlight */}
      <MarketHero slides={featured} statusOf={statusOf} checkingOf={checkingOf} onPick={pick} />

      {/* Toolbar: search + category chips */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
          <input
            value={marketQuery}
            onChange={(e) => setMarketQuery(e.target.value)}
            placeholder={t('connect.marketSearch')}
            className="w-full h-9 rounded-lg border bg-background pl-9 pr-3 text-xs outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 transition-shadow"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {marketCats.map((c) => (
            <button
              key={c.key}
              onClick={() => setMarketCat(c.key)}
              className={cn(
                'whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors',
                marketCat === c.key
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Marketplace grid — Popular agents first, then everything else. */}
      {(() => {
        const popular = MARKET_POPULAR_AGENTS
          .map((n) => visible.find((e) => e.name === n))
          .filter((e): e is (typeof visible)[number] => !!e);
        const others = visible.filter((e) => !MARKET_POPULAR_AGENTS.includes(e.name));

        const renderCard = (entry: (typeof visible)[number]) => (
          <button
            key={entry.name}
            onClick={() => pick(entry.name)}
            className="group relative flex flex-col gap-3 rounded-2xl border bg-background p-4 text-left transition-all duration-200 hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/[0.08] hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-3">
              <MarketLogo name={entry.name} size={44} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold leading-tight truncate">{entry.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80 truncate">{entry.vendor || entry.tags?.[0] || ''}</div>
              </div>
            </div>

            <p className="text-[11.5px] leading-relaxed text-muted-foreground line-clamp-2 min-h-[33px]">{entry.description}</p>

            {/* Footer: live device status + an always-visible Add CTA (the
                whole card is the click target; this span is its label). */}
            <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
              <MarketStatusBadge status={statusOf(entry.name)} checking={checkingOf(entry.name)} />
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[10.5px] font-semibold text-white transition-colors group-hover:bg-indigo-500">
                {t('connect.marketAdd')} <ArrowRight className="size-3" />
              </span>
            </div>
          </button>
        );

        if (visible.length === 0) {
          return (
            <div className="rounded-2xl border border-dashed py-14 text-center text-sm text-muted-foreground">
              {t('connect.marketNoMatch', { query: marketQuery })}{' '}
              <button className="text-indigo-600 dark:text-indigo-400 font-medium" onClick={() => { setMarketQuery(''); setMarketCat('all'); }}>
                {t('connect.marketReset')}
              </button>
            </div>
          );
        }
        return (
          <div className="space-y-5">
            {popular.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('connect.marketPopular')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {popular.map(renderCard)}
                </div>
              </div>
            )}
            {others.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('connect.marketOthers')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {others.map(renderCard)}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
