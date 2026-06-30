'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, Search, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { WorkspaceAgent, EvaluationDataset, EvaluationInstance, EvaluationPrecheck } from '@/lib/types';
import { workspaceApi } from '@/lib/api';

interface CreateEvaluationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  onCreated: () => void;
}

export function CreateEvaluationDialog({ open, onOpenChange, agents, onCreated }: CreateEvaluationDialogProps) {
  // Only co-located coding agents (online + a working directory) can run jobs.
  const eligibleAgents = agents.filter((a) => a.status === 'online' && a.workingDir);

  const [datasets, setDatasets] = useState<EvaluationDataset[]>([]);
  const [dataset, setDataset] = useState('');
  const [split, setSplit] = useState('test');
  const [agent, setAgent] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'strict' | 'debug'>('strict');
  const [instances, setInstances] = useState<EvaluationInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [precheck, setPrecheck] = useState<EvaluationPrecheck | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDataset = datasets.find((d) => d.key === dataset);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPrecheck(null);
    setInstanceId('');
    setSearch('');
    setInstances([]);
    setAgent(eligibleAgents[0]?.agentName || '');
    workspaceApi.listEvaluationDatasets().then((res) => {
      const enabled = res.datasets.filter((d) => d.enabled);
      setDatasets(res.datasets);
      if (enabled[0]) {
        setDataset(enabled[0].key);
        setSplit(enabled[0].default_split);
      }
    }).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadInstances = useCallback(async () => {
    if (!dataset) return;
    setLoadingInstances(true);
    try {
      const res = await workspaceApi.listEvaluationInstances({ dataset, split, search, limit: 30 });
      setInstances(res.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingInstances(false);
    }
  }, [dataset, split, search]);

  const runPrecheck = useCallback(async () => {
    try {
      setPrecheck(await workspaceApi.evaluationPrecheck(dataset, split));
    } catch (e) {
      setError(String(e));
    }
  }, [dataset, split]);

  const handleSubmit = async () => {
    if (!agent || !dataset || !instanceId) return;
    setSubmitting(true);
    setError(null);
    try {
      await workspaceApi.createEvaluation({ dataset, split, instance_id: instanceId, agent, mode, source: 'human:user' });
      onCreated();
      onOpenChange(false);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          Run SWE-bench evaluation
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Experimental</span>
        </DialogTitle>
        <DialogDescription>
          Hand one benchmark instance to a connected coding agent, then grade it with the official Docker harness.
          Results are for local regression testing and are <strong>not leaderboard-comparable</strong>.
        </DialogDescription>

        <div className="space-y-3 mt-2">
          {eligibleAgents.length === 0 && (
            <div className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 px-3 py-2">
              No eligible agent. SWE-bench needs an <strong>online</strong> coding agent with a working
              directory on this host.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Agent</label>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                disabled={submitting}
                className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
              >
                {eligibleAgents.map((a) => (
                  <option key={a.agentName} value={a.agentName}>{a.agentName}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Dataset</label>
              <select
                value={dataset}
                onChange={(e) => {
                  setDataset(e.target.value);
                  const d = datasets.find((x) => x.key === e.target.value);
                  if (d) setSplit(d.default_split);
                  setInstances([]);
                  setInstanceId('');
                }}
                disabled={submitting}
                className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
              >
                {datasets.map((d) => (
                  <option key={d.key} value={d.key} disabled={!d.enabled}>
                    {d.label}{d.enabled ? '' : ' (disabled)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedDataset && selectedDataset.splits.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Split</label>
              <select
                value={split}
                onChange={(e) => { setSplit(e.target.value); setInstances([]); setInstanceId(''); }}
                disabled={submitting}
                className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
              >
                {selectedDataset.splits.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Instance</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  value={instanceId || search}
                  onChange={(e) => { setSearch(e.target.value); setInstanceId(''); }}
                  placeholder="search repo or instance id…"
                  className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-7 pr-3 py-2"
                />
              </div>
              <Button variant="outline" size="sm" onClick={loadInstances} disabled={!dataset || loadingInstances}>
                {loadingInstances ? <Loader2 className="size-3.5 animate-spin" /> : 'Browse'}
              </Button>
            </div>
            {instances.length > 0 && !instanceId && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
                {instances.map((i) => (
                  <button
                    key={i.instance_id}
                    onClick={() => { setInstanceId(i.instance_id); setInstances([]); }}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <div className="text-xs font-medium">{i.instance_id}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{i.problem_summary}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Integrity mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'strict' | 'debug')}
              disabled={submitting}
              className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
            >
              <option value="strict">strict — reject patches that touch tests / eval infra (default)</option>
              <option value="debug">debug — run anyway, flag integrity risk (not a valid result)</option>
            </select>
          </div>

          <div>
            <Button variant="ghost" size="sm" onClick={runPrecheck} className="text-xs h-7">
              Run environment precheck
            </Button>
            {precheck && (
              <div className="mt-1 space-y-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                {precheck.checks.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 text-[11px]">
                    {c.level === 'error'
                      ? <XCircle className="size-3.5 text-red-500 shrink-0" />
                      : c.level === 'warn'
                        ? <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
                        : <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />}
                    <span className="text-muted-foreground">{c.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !agent || !dataset || !instanceId}
            className={cn(submitting && 'opacity-70')}
          >
            {submitting ? <><Loader2 className="size-3.5 animate-spin mr-1" /> Queuing…</> : 'Run evaluation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
