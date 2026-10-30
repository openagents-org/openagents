'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardList, Crown, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { briefFromApi, briefIsEmpty, briefPatchToApi, diffBrief, ownerLabel } from '@/lib/brief';
import type { ChannelBrief, ChannelBriefPatch, WorkspaceAgent } from '@/lib/types';

const REFRESH_MS = 30_000;
const MESSAGE_REFRESH_DEBOUNCE_MS = 800;

/**
 * The thread's brief, refreshed on thread change, whenever `refreshKey`
 * changes (the caller passes the message count so an agent's update shows up
 * with its reply), and every 30s while the tab is visible.
 */
export function useBrief(channelName: string | null, refreshKey: unknown): {
  brief: ChannelBrief | null;
  saveBrief: (patch: ChannelBriefPatch) => Promise<void>;
  reload: () => Promise<void>;
} {
  const [brief, setBrief] = useState<ChannelBrief | null>(null);
  const channelRef = useRef(channelName);
  channelRef.current = channelName;

  const reload = useCallback(async () => {
    const ch = channelRef.current;
    if (!ch || !workspaceApi.isConfigured()) return;
    try {
      const raw = await workspaceApi.getBriefRaw(ch);
      if (channelRef.current === ch) setBrief(briefFromApi(raw, ch));
    } catch {
      // Not fatal — the thread still works without its brief.
    }
  }, []);

  // Thread switch: drop the old brief and fetch the new one.
  useEffect(() => {
    setBrief(null);
    void reload();
  }, [channelName, reload]);

  // New messages: an agent may just have updated the brief.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    const id = setTimeout(() => { void reload(); }, MESSAGE_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [refreshKey, reload]);

  // Slow poll while visible.
  useEffect(() => {
    if (!channelName) return;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void reload();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [channelName, reload]);

  const saveBrief = useCallback(async (patch: ChannelBriefPatch) => {
    const ch = channelRef.current;
    if (!ch) return;
    const raw = await workspaceApi.putBriefRaw(ch, briefPatchToApi(patch));
    if (channelRef.current === ch) setBrief(briefFromApi(raw, ch));
  }, []);

  return { brief, saveBrief, reload };
}

interface WorkBriefProps {
  brief: ChannelBrief;
  onSave: (patch: ChannelBriefPatch) => Promise<void>;
  agents?: WorkspaceAgent[];
  /** Lower-cased email of the signed-in person, '' when unknown. */
  currentUserEmail?: string;
}

interface Draft {
  objective: string;
  owner: string;
  latestResult: string;
  nextStep: string;
  openQuestions: string;
}

function draftFrom(brief: ChannelBrief): Draft {
  return {
    objective: brief.objective ?? '',
    owner: brief.owner ?? '',
    latestResult: brief.latestResult ?? '',
    nextStep: brief.nextStep ?? '',
    openQuestions: brief.openQuestions.join('\n'),
  };
}

/**
 * v1.1 M5 — the collapsible "Brief" card pinned above a thread's messages.
 * Expanded when anything is written, a one-line strip when empty. People who
 * are participants (or admins) edit it inline; agents keep it current through
 * `workspace_update_brief`.
 */
export function WorkBrief({ brief, onSave, agents = [], currentUserEmail = '' }: WorkBriefProps) {
  const t = useT();
  const { formatDateTime } = useFormatters();
  const empty = briefIsEmpty(brief);
  // null = follow emptiness; true/false = the person toggled it for this thread.
  const [manual, setManual] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(brief));
  const [saving, setSaving] = useState(false);

  // A new thread → forget the manual toggle and any half-typed edit.
  useEffect(() => {
    setManual(null);
    setEditing(false);
  }, [brief.channel]);

  const expanded = manual ?? !empty;

  const agentLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const a of agents) labels[a.agentName] = agentLabel(a);
    return labels;
  }, [agents]);

  const directorName = brief.directorEmail
    ? (currentUserEmail && brief.directorEmail === currentUserEmail ? t('brief.you') : brief.directorEmail)
    : null;

  const startEditing = () => {
    setDraft(draftFrom(brief));
    setEditing(true);
    setManual(true);
  };

  const save = async () => {
    const patch = diffBrief(brief, draft);
    if (Object.keys(patch).length === 0) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(patch);
      setEditing(false);
    } catch (err) {
      toast.error(`${t('brief.saveFailed')}${err instanceof Error && err.message ? ` (${err.message})` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  const updatedLine = brief.updatedAt
    ? t('brief.updatedBy', {
        name: ownerLabel(brief.updatedBy, agentLabels) || '—',
        time: formatDateTime(brief.updatedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      })
    : null;

  const shell = 'border-b border-border/50 bg-primary/[0.02]';
  const inner = 'mx-auto w-full max-w-3xl xl:max-w-4xl 2xl:max-w-6xl px-4 lg:px-8';

  if (!expanded) {
    return (
      <div className={shell} data-work-brief="collapsed">
        <div className={cn(inner, 'flex items-center gap-2 py-1.5 text-[12px] text-muted-foreground')}>
          <button
            type="button"
            onClick={() => setManual(true)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
            title={t('brief.expand')}
          >
            <ClipboardList className="size-3.5 shrink-0" />
            <span className="truncate">
              {empty ? t('brief.emptyCollapsed') : `${t('brief.title')} · ${brief.objective || brief.nextStep || brief.latestResult}`}
            </span>
            {directorName && (
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Crown className="size-3 text-amber-500" />
                {t('brief.directedBy', { name: directorName })}
              </span>
            )}
          </button>
          {empty && brief.canEdit && (
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
            >
              {t('brief.start')}
            </button>
          )}
          <button type="button" onClick={() => setManual(true)} className="shrink-0" title={t('brief.expand')}>
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const field = (label: string, value: string | null, mono = false) => (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug', !value && 'text-muted-foreground/60', mono && 'font-mono text-[12px]')}>
        {value || t('brief.none')}
      </div>
    </div>
  );

  return (
    <div className={shell} data-work-brief="expanded">
      <div className={cn(inner, 'py-2.5')}>
        <div className="flex items-center gap-2">
          <ClipboardList className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12px] font-semibold">{t('brief.title')}</span>
          {directorName && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <Crown className="size-2.5" />
              {t('brief.directedBy', { name: directorName })}
            </span>
          )}
          <span className="flex-1" />
          {brief.canEdit && !editing && (
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={startEditing}>
              <Pencil className="size-3" />
              {t('brief.edit')}
            </Button>
          )}
          <button type="button" onClick={() => { setManual(false); setEditing(false); }} className="text-muted-foreground hover:text-foreground" title={t('brief.collapse')}>
            <ChevronUp className="size-3.5" />
          </button>
        </div>

        {editing ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
              {t('brief.objective')}
              <Textarea rows={2} value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value })} className="mt-1 text-[13px]" />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('brief.latestResult')}
              <Textarea rows={2} value={draft.latestResult} onChange={(e) => setDraft({ ...draft, latestResult: e.target.value })} className="mt-1 text-[13px]" />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('brief.nextStep')}
              <Textarea rows={2} value={draft.nextStep} onChange={(e) => setDraft({ ...draft, nextStep: e.target.value })} className="mt-1 text-[13px]" />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('brief.openQuestions')}
              <Textarea rows={3} value={draft.openQuestions} placeholder={t('brief.openQuestionsHint')} onChange={(e) => setDraft({ ...draft, openQuestions: e.target.value })} className="mt-1 text-[13px]" />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('brief.owner')}
              <Input value={draft.owner} placeholder={t('brief.ownerPlaceholder')} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} className="mt-1 font-mono text-[12px]" />
            </label>
            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        ) : empty ? (
          <p className="mt-1.5 text-[12px] text-muted-foreground">{t('brief.empty')}</p>
        ) : (
          <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div className="sm:col-span-2">{field(t('brief.objective'), brief.objective)}</div>
            {field(t('brief.latestResult'), brief.latestResult)}
            {field(t('brief.nextStep'), brief.nextStep)}
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('brief.openQuestions')}</div>
              {brief.openQuestions.length === 0 ? (
                <div className="mt-0.5 text-[13px] text-muted-foreground/60">{t('brief.none')}</div>
              ) : (
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[13px] leading-snug">
                  {brief.openQuestions.map((q, i) => <li key={i} className="break-words">{q}</li>)}
                </ul>
              )}
            </div>
            {field(t('brief.owner'), ownerLabel(brief.owner, agentLabels) || null, true)}
          </div>
        )}

        {!editing && updatedLine && (
          <div className="mt-2 text-[10px] text-muted-foreground">{updatedLine}</div>
        )}
      </div>
    </div>
  );
}
