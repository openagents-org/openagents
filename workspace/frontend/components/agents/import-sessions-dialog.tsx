'use client';

/**
 * Import past sessions: a person's own Claude Code, Codex, OpenCode or Hermes
 * sessions on one of their devices, brought in as private threads.
 *
 * The device lists its sessions (node command `list_local_sessions`, owner
 * only) and, for each one picked, reads it and uploads the conversation
 * (`import_local_session`) — the session never leaves the device until it is
 * picked. Each becomes a thread with the chosen agent in it; an agent of the
 * same tool on the same device continues the real session from a copy.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { isOwnedAgent } from '@/lib/sidebar-agents';
import type { NodeCommand, WorkspaceNode } from '@/lib/types';
import { Spinner } from '@/components/ui/spinner';

export const IMPORTABLE_TYPES = ['claude', 'codex', 'opencode', 'hermes'] as const;
export type ImportableType = typeof IMPORTABLE_TYPES[number];
export const IMPORT_TOOL_LABELS: Record<ImportableType, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes' };
const TOOL_LABELS = IMPORT_TOOL_LABELS;

export function isImportableType(type: string | null | undefined): type is ImportableType {
  return !!type && (IMPORTABLE_TYPES as readonly string[]).includes(type);
}

export interface LocalSession { id: string; type: string; title: string; cwd: string | null; updatedAt: string; messageCount: number | null }
type Outcome = { state: 'running' } | { state: 'done'; channel: string; resumable: boolean } | { state: 'error'; message: string };

/** Wait for a device command to finish: up to ~2 minutes (the device picks it up within ~10 s). */
export async function waitForNodeCommand(nodeId: string, commandId: string, tries = 80): Promise<NodeCommand | null> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const c = await workspaceApi.getNodeCommand(nodeId, commandId).catch(() => null);
    if (c && (c.status === 'done' || c.status === 'error')) return c;
  }
  return null;
}

export function ImportSessionsDialog({ open, onOpenChange, node, type: initialType, agentName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: WorkspaceNode;
  /** The tool to start on; defaults to the agent's type. */
  type?: ImportableType;
  /** The agent the threads go to by default. */
  agentName?: string;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const { agents, refreshWorkspace, setCurrentSessionId, currentUser } = useWorkspace();
  const { openView, openMobileDetail } = useLayout();
  const [type, setType] = useState<ImportableType>(initialType || 'claude');
  const [sessions, setSessions] = useState<LocalSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>(agentName || '');
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const importing = Object.values(outcomes).some((o) => o.state === 'running');

  // The device's sessions for the chosen tool.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSessions(null); setError(null); setPicked(new Set()); setOutcomes({});
    (async () => {
      try {
        const cmd = await workspaceApi.enqueueNodeCommand(node.nodeId, 'list_local_sessions', { type });
        const done = await waitForNodeCommand(node.nodeId, cmd.commandId, 40);
        if (cancelled) return;
        if (!done) { setError(t('importSessions.deviceSilent')); return; }
        if (!done.result?.ok) { setError(done.result?.message || t('importSessions.listFailed')); return; }
        const data = done.result.data as { sessions?: LocalSession[] } | undefined;
        setSessions(data?.sessions || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('importSessions.listFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [open, type, node.nodeId, t]);

  // Who can continue them: only the person's own agents — a private session
  // given to someone else's agent would hand it the whole history. The
  // device's own agents of this tool come first; Claude Code and Codex ones
  // continue the real session.
  const choices = useMemo(() => {
    const local = new Set(node.agents.filter((a) => a.type === type).map((a) => a.name));
    const resumes = (name: string) => local.has(name) && (type === 'claude' || type === 'codex');
    return [...agents]
      .filter((a) => a.role !== 'removed' && isOwnedAgent(a, currentUser.id))
      .sort((a, b) => Number(local.has(b.agentName)) - Number(local.has(a.agentName)))
      .map((a) => ({ name: a.agentName, label: a.displayName || a.agentName, resumes: resumes(a.agentName) }));
  }, [agents, node.agents, type, currentUser.id]);
  useEffect(() => {
    if (target && !choices.some((c) => c.name === target)) setTarget('');
    else if (!target && choices.length) setTarget(choices[0].name);
  }, [choices, target]);

  const visible = (sessions || []).filter((s) => `${s.title} ${s.cwd || ''}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runImport = async () => {
    const ids = [...picked];
    setOutcomes(Object.fromEntries(ids.map((id) => [id, { state: 'running' } as Outcome])));
    await Promise.all(ids.map(async (id) => {
      let outcome: Outcome;
      try {
        const cmd = await workspaceApi.enqueueNodeCommand(node.nodeId, 'import_local_session', { type, id, agent: target || null });
        const done = await waitForNodeCommand(node.nodeId, cmd.commandId);
        const data = done?.result?.data as { channel?: string; resumable?: boolean } | undefined;
        outcome = done?.result?.ok && data?.channel
          ? { state: 'done', channel: data.channel, resumable: !!data.resumable }
          : { state: 'error', message: done ? (done.result?.message || t('importSessions.importFailed')) : t('importSessions.stillImporting') };
      } catch (e) {
        outcome = { state: 'error', message: e instanceof Error ? e.message : t('importSessions.importFailed') };
      }
      setOutcomes((prev) => ({ ...prev, [id]: outcome }));
    }));
    setPicked(new Set());
    await refreshWorkspace().catch(() => {});
  };

  const finished = Object.entries(outcomes).filter(([, o]) => o.state === 'done') as [string, Extract<Outcome, { state: 'done' }>][];
  const openThread = (channel: string) => {
    onOpenChange(false);
    setCurrentSessionId(channel);
    openView('threads');
    openMobileDetail();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!importing) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('importSessions.title')}</DialogTitle>
          <DialogDescription>{t('importSessions.description', { device: node.name || node.hostname || '' })}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="flex gap-2">
            <Select value={type} onValueChange={(v) => setType(v as ImportableType)} disabled={importing}>
              <SelectTrigger aria-label={t('importSessions.tool')} className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{IMPORTABLE_TYPES.map((ty) => <SelectItem key={ty} value={ty}>{TOOL_LABELS[ty]}</SelectItem>)}</SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('importSessions.search')} aria-label={t('importSessions.search')} className="h-9 pl-8" />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border" data-testid="import-sessions-list">
            {error ? <p className="p-4 text-sm text-muted-foreground">{error}</p>
              : sessions === null ? <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner aria-hidden="true" className="size-4" />{t('importSessions.loading')}</p>
              : visible.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t('importSessions.empty', { tool: TOOL_LABELS[type] })}</p>
              : visible.map((s) => {
                const o = outcomes[s.id];
                return (
                  <label key={s.id} className="flex cursor-pointer items-start gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/40">
                    <Checkbox checked={picked.has(s.id)} onCheckedChange={() => toggle(s.id)} disabled={importing || !!o} aria-label={s.title} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[s.cwd, typeof s.messageCount === 'number' ? t(s.messageCount === 1 ? 'importSessions.message' : 'importSessions.messages', { count: s.messageCount }) : null, timeAgo(s.updatedAt)].filter(Boolean).join(' · ')}
                      </span>
                      {o?.state === 'error' && <span className="block text-xs text-destructive">{o.message}</span>}
                    </span>
                    {o?.state === 'running' && <Spinner aria-hidden="true" className="mt-1 size-4 text-muted-foreground" />}
                    {o?.state === 'done' && <Check className="mt-1 size-4 text-emerald-600" />}
                  </label>
                );
              })}
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">{t('importSessions.agent')}</span>
            <Select value={target} onValueChange={setTarget} disabled={importing}>
              <SelectTrigger aria-label={t('importSessions.agent')} className="h-9 min-w-0 flex-1"><SelectValue placeholder={t('importSessions.noAgent')} /></SelectTrigger>
              <SelectContent>
                {choices.map((c) => <SelectItem key={c.name} value={c.name}>{c.label}{c.resumes ? ` · ${t('importSessions.continues')}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {!choices.length ? t('importSessions.noOwnAgents') : choices.find((c) => c.name === target)?.resumes ? t('importSessions.resumeHint') : t('importSessions.contextHint')}
            {' '}{t('importSessions.privacyHint')}
          </p>

          {finished.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2 text-sm" data-testid="import-sessions-done">
              <p className="mb-1 text-xs text-muted-foreground">{t('importSessions.imported', { count: finished.length })}</p>
              {finished.map(([id, o]) => (
                <Button key={id} type="button" variant="link" size="xs" className="h-auto w-full justify-start px-0" onClick={() => openThread(o.channel)}>
                  <span className="truncate">{(sessions || []).find((s) => s.id === id)?.title || id}</span>
                </Button>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>{t('common.close')}</Button>
          <Button onClick={() => void runImport()} disabled={importing || picked.size === 0 || !!error || !target} data-testid="import-sessions-submit">
            {importing ? <Spinner aria-hidden="true" className="size-4" /> : null}
            {t('importSessions.import', { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
