'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FlaskConical, Plus, RefreshCw, Loader2, CheckCircle2, XCircle,
  AlertTriangle, Clock, Ban, X, FileText, ScrollText, ShieldAlert, ShieldX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import type { EvaluationJob } from '@/lib/types';
import { CreateEvaluationDialog } from './create-evaluation-dialog';

const ACTIVE_STATUSES = new Set(['queued', 'preparing', 'agent_running', 'patch_collected', 'evaluating']);

const EXPERIMENTAL_NOTICE =
  'Experimental local evaluation. Results are intended for local regression testing and are not leaderboard-comparable by default.';

function StatusBadge({ job }: { job: EvaluationJob }) {
  const s = job.status;
  let icon = <Clock className="size-3.5" />;
  let cls = 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800';
  let label: string = s;

  if (ACTIVE_STATUSES.has(s)) {
    icon = <Loader2 className="size-3.5 animate-spin" />;
    cls = 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300';
    label = s.replace('_', ' ');
  } else if (s === 'integrity_rejected') {
    icon = <ShieldX className="size-3.5" />;
    cls = 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300';
    label = 'integrity rejected';
  } else if (s === 'completed') {
    if (job.resolved) {
      icon = <CheckCircle2 className="size-3.5" />;
      cls = 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300';
      label = 'resolved';
    } else {
      icon = <XCircle className="size-3.5" />;
      cls = 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300';
      label = 'unresolved';
    }
  } else if (s === 'failed') {
    icon = <XCircle className="size-3.5" />;
    cls = 'text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-300';
    label = job.outcome || 'failed';
  } else if (s === 'timeout') {
    icon = <Clock className="size-3.5" />;
    cls = 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300';
  } else if (s === 'cancelled') {
    icon = <Ban className="size-3.5" />;
    cls = 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800';
  } else if (s === 'error') {
    icon = <AlertTriangle className="size-3.5" />;
    cls = 'text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-300';
  }

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium', cls)}>
      {icon}{label}
    </span>
  );
}

function protectedFiles(job: EvaluationJob): string[] {
  const integ = (job.docker_info as { integrity?: { protected_files?: string[] } } | null)?.integrity;
  return integ?.protected_files?.slice(0, 8) ?? [];
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function BenchmarksView() {
  const { agents } = useWorkspace();
  const [jobs, setJobs] = useState<EvaluationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await workspaceApi.listEvaluations();
      setJobs(list);
      setSelectedId((cur) => cur ?? (list[0]?.id ?? null));
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Poll while any job is active.
  useEffect(() => {
    const anyActive = jobs.some((j) => ACTIVE_STATUSES.has(j.status));
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (anyActive) {
      pollRef.current = setInterval(refresh, 4000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs, refresh]);

  const selected = jobs.find((j) => j.id === selectedId) || null;

  const handleCancel = async (id: string) => {
    try { await workspaceApi.cancelEvaluation(id); await refresh(); } catch { /* ignore */ }
  };
  const handleRetry = async (id: string) => {
    try {
      const job = await workspaceApi.retryEvaluation(id);
      await refresh();
      setSelectedId(job.id);
    } catch { /* ignore */ }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Benchmarks</h2>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Experimental</span>
          <span className="text-xs text-muted-foreground">SWE-bench · {jobs.length}</span>
        </div>
        <div className="flex gap-0.5">
          <button onClick={() => setShowCreate(true)} title="New evaluation"
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <Plus className="size-3.5" />
          </button>
          <button onClick={refresh} title="Refresh"
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="shrink-0 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/50 dark:border-amber-900/40">
        {EXPERIMENTAL_NOTICE} Local / self-hosted only.
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Job list */}
        <div className="w-[300px] shrink-0 border-r border-border overflow-y-auto">
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 px-4 text-center">
              <FlaskConical className="size-8 opacity-30" />
              <p className="text-sm">No evaluations yet</p>
              <p className="text-[11px]">SWE-bench is a benchmark, not an agent. Pick a dataset, an instance, and a connected coding agent.</p>
            </div>
          ) : (
            <div className="py-1">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 flex flex-col gap-1 transition-colors',
                    selectedId === job.id ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{job.instance_id}</span>
                    <StatusBadge job={job} />
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {job.dataset} · {job.agent}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {selected ? <JobDetail job={selected} onCancel={handleCancel} onRetry={handleRetry} /> : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select an evaluation
            </div>
          )}
        </div>
      </div>

      <CreateEvaluationDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        agents={agents}
        onCreated={refresh}
      />
    </div>
  );
}

function JobDetail({ job, onCancel, onRetry }: {
  job: EvaluationJob;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'patch' | 'logs'>('overview');
  const [patch, setPatch] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const isActive = ACTIVE_STATUSES.has(job.status);
  const isTerminal = ['completed', 'failed', 'timeout', 'cancelled', 'error'].includes(job.status);

  useEffect(() => { setTab('overview'); setPatch(null); setLogs(null); }, [job.id]);

  useEffect(() => {
    if (tab === 'patch' && patch === null && job.patch_available) {
      workspaceApi.getEvaluationPatch(job.id).then(setPatch).catch(() => setPatch('(failed to load patch)'));
    }
    if (tab === 'logs' && logs === null && job.logs_available) {
      workspaceApi.getEvaluationLogs(job.id).then(setLogs).catch(() => setLogs('(failed to load logs)'));
    }
  }, [tab, job, patch, logs]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{job.instance_id}</h3>
            <StatusBadge job={job} />
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {job.dataset} · {job.split} · agent <strong>{job.agent}</strong>
          </div>
        </div>
        <div className="flex gap-1.5">
          {isActive && (
            <Button size="sm" variant="outline" onClick={() => onCancel(job.id)}>
              <X className="size-3.5 mr-1" /> Cancel
            </Button>
          )}
          {isTerminal && (
            <Button size="sm" variant="outline" onClick={() => onRetry(job.id)}>
              <RefreshCw className="size-3.5 mr-1" /> Retry
            </Button>
          )}
        </div>
      </div>

      {/* Stage strip */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {['queued', 'preparing', 'agent_running', 'patch_collected', 'evaluating'].map((stage) => (
          <span key={stage}
            className={cn('px-2 py-0.5 rounded-full',
              job.status === stage ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800')}>
            {stage.replace('_', ' ')}
          </span>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['overview', 'patch', 'logs'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-1.5 text-xs border-b-2 -mb-px',
              tab === t ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>
            {t === 'patch' && <FileText className="size-3 inline mr-1" />}
            {t === 'logs' && <ScrollText className="size-3 inline mr-1" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2 text-xs">
          <Row label="Repository" value={job.repo || '—'} />
          <Row label="Base commit" value={job.base_commit ? job.base_commit.slice(0, 12) : '—'} />
          <Row label="Integrity mode" value={job.integrity_mode || 'strict'} />
          <Row label="Outcome" value={job.outcome || (isActive ? 'in progress' : '—')} />
          <Row label="Resolved" value={job.resolved == null ? '—' : job.resolved ? 'yes ✓' : 'no'} />
          <Row label="Duration" value={formatDuration(job.duration_seconds)} />
          <Row label="Run id" value={job.run_id || '—'} />

          {job.status === 'integrity_rejected' && (
            <div className="rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-3 py-2 text-[11px] flex gap-2">
              <ShieldX className="size-4 shrink-0" />
              <div>
                <div className="font-medium">Patch changed test or evaluation infrastructure</div>
                <div>Rejected before the harness ran. Not a valid result. {protectedFiles(job).join(', ')}</div>
              </div>
            </div>
          )}
          {job.integrity_risk && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 px-3 py-2 text-[11px] flex gap-2">
              <ShieldAlert className="size-4 shrink-0" />
              <div>Integrity risk: the patch touched test/evaluation files and ran in <strong>debug</strong> mode. This is NOT a valid formal result. {protectedFiles(job).join(', ')}</div>
            </div>
          )}
          {job.error_reason && job.status !== 'integrity_rejected' && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-3 py-2">
              <div className="font-medium">{job.error_category || 'error'}</div>
              <div className="text-[11px]">{job.error_reason}</div>
            </div>
          )}

          {job.environment && (
            <div className="mt-3 pt-2 border-t border-border/50">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Environment</div>
              <Row label="swebench" value={String((job.environment as Record<string, unknown>).swebench_version ?? '—')} />
              <Row label="python" value={String((job.environment as Record<string, unknown>).python_version ?? '—')} />
              <Row label="docker" value={String((job.environment as Record<string, unknown>).docker_version ?? '—')} />
              <Row label="os / arch" value={`${(job.environment as Record<string, unknown>).os ?? '?'} / ${(job.environment as Record<string, unknown>).arch ?? '?'}`} />
            </div>
          )}
        </div>
      )}

      {tab === 'patch' && (
        <pre className="text-[11px] bg-zinc-50 dark:bg-zinc-900 rounded-md p-3 overflow-x-auto max-h-[55vh] overflow-y-auto whitespace-pre-wrap">
          {job.patch_available ? (patch ?? 'Loading…') : 'No patch collected.'}
        </pre>
      )}

      {tab === 'logs' && (
        <pre className="text-[11px] bg-zinc-50 dark:bg-zinc-900 rounded-md p-3 overflow-x-auto max-h-[55vh] overflow-y-auto whitespace-pre-wrap">
          {job.logs_available ? (logs ?? 'Loading…') : 'No harness logs yet.'}
        </pre>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}
