'use client';

/**
 * "Bring your memory": review what an agent can keep from the user's own
 * Claude Code / Codex / OpenClaw setup and copy it over, explicitly.
 *
 * Everything runs on the user's device through node commands
 * (memory_scan / memory_import / memory_undo / memory_dismiss, see the
 * connector's memory-import.js). The workspace only ever sees labels, file
 * names and sizes; the memory itself stays on the device.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, Check, ChevronDown, ChevronRight, Loader2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import type {
  MemoryImportReceipt,
  MemoryItemKind,
  MemoryScan,
  MemoryScanItem,
  NodeCommand,
  NodeMemorySummary,
} from '@/lib/types';

/** The two node-command calls this needs; WorkspaceAPI and AgentSetupApi both fit. */
export interface MemoryImportApi {
  enqueueNodeCommand(nodeId: string, action: string, args: Record<string, unknown>): Promise<{ commandId?: string }>;
  listNodeCommands(nodeId: string): Promise<NodeCommand[]>;
}

/** Agent types the device can import memory for. */
export const MEMORY_IMPORT_TYPES = new Set(['claude', 'codex', 'openclaw']);
const TOOL_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', openclaw: 'OpenClaw' };

const POLL_MS = 1500;
const TIMEOUT_MS = 60_000;

class CommandTimeout extends Error {}
class UnknownAction extends Error {}

/** Queue a node command and wait for the device to report back. */
async function runNodeCommand<T>(
  api: MemoryImportApi,
  nodeId: string,
  action: string,
  args: Record<string, unknown>,
  cancelled: () => boolean,
): Promise<T> {
  const cmd = await api.enqueueNodeCommand(nodeId, action, args);
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (cancelled()) throw new Error('cancelled');
    const cmds = await api.listNodeCommands(nodeId).catch(() => [] as NodeCommand[]);
    const c = cmds.find((x) => x.commandId === cmd.commandId);
    if (c && (c.status === 'done' || c.status === 'error')) {
      if (c.status === 'done' && c.result?.ok) return c.result.data as T;
      const message = c.result?.message || '';
      // A launcher from before memory import answers "Unknown action".
      if (/Unknown action/i.test(message)) throw new UnknownAction(message);
      throw new Error(message || 'failed');
    }
  }
  throw new CommandTimeout();
}

function formatBytes(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / (1024 * 104.8576)) / 10} MB`;
}

function KindBadge({ kind }: { kind: MemoryItemKind }) {
  const t = useT();
  const label = {
    memory: t('memoryImport.kindMemory'),
    instructions: t('memoryImport.kindInstructions'),
    skill: t('memoryImport.kindSkill'),
    persona: t('memoryImport.kindPersona'),
  }[kind] || kind;
  return <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>;
}

function ItemRow({ item, checked, onToggle }: { item: MemoryScanItem; checked?: boolean; onToggle?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selectable = item.status === 'importable' && !!onToggle;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        {selectable ? (
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 shrink-0"
            checked={!!checked}
            onChange={onToggle}
            aria-label={item.label}
          />
        ) : item.status === 'imported' || item.status === 'loaded' ? (
          <Check className="mt-0.5 size-3.5 shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{item.label}</span>
            <KindBadge kind={item.kind} />
          </div>
          <div className="text-muted-foreground break-all">
            {item.source}
            {item.fileCount ? ` · ${t('memoryImport.files', { count: item.fileCount })}` : ''}
            {item.bytes ? ` · ${formatBytes(item.bytes)}` : ''}
          </div>
          {item.description && <div className="text-muted-foreground">{item.description}</div>}
          {item.note && <div className="text-muted-foreground">{item.note}</div>}
          {item.secret && (
            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3 shrink-0" />{t('memoryImport.secretWarning')}
            </div>
          )}
          {item.files.length > 0 && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {open ? t('memoryImport.hideFiles') : t('memoryImport.showFiles')}
            </button>
          )}
          {open && (
            <ul className="mt-1 max-h-32 overflow-y-auto rounded bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {item.files.map((f) => <li key={f} className="break-all">{f}</li>)}
              {item.fileCount > item.files.length && <li>…</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

type Phase =
  | { kind: 'scanning' }
  | { kind: 'error'; message: string }
  | { kind: 'review'; scan: MemoryScan }
  | { kind: 'importing'; scan: MemoryScan }
  | { kind: 'receipt'; receipt: MemoryImportReceipt };

/**
 * The review → import → receipt dialog. Opens on a fresh scan of the device.
 */
export function MemoryImportDialog({ api, nodeId, deviceName, agentName, agentType, open, onOpenChange, onChanged }: {
  api: MemoryImportApi;
  nodeId: string;
  deviceName?: string | null;
  agentName: string;
  agentType: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const tool = TOOL_LABEL[agentType] || agentType;
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [undoing, setUndoing] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const errorText = useCallback((e: unknown) => {
    if (e instanceof CommandTimeout) return t('memoryImport.scanTimeout');
    if (e instanceof UnknownAction) return t('memoryImport.olderLauncher');
    return e instanceof Error && e.message ? e.message : t('memoryImport.scanFailed');
  }, [t]);

  const scan = useCallback(async () => {
    setPhase({ kind: 'scanning' });
    try {
      const data = await runNodeCommand<MemoryScan>(api, nodeId, 'memory_scan', { name: agentName }, () => !alive.current);
      if (!alive.current) return;
      setPicked(new Set(data.items.filter((i) => i.selected).map((i) => i.id)));
      setPhase({ kind: 'review', scan: data });
    } catch (e) {
      if (alive.current) setPhase({ kind: 'error', message: errorText(e) });
    }
  }, [api, nodeId, agentName, errorText]);

  useEffect(() => { if (open) scan(); }, [open, scan]);

  const doImport = async (current: MemoryScan) => {
    setPhase({ kind: 'importing', scan: current });
    try {
      const data = await runNodeCommand<{ receipt: MemoryImportReceipt }>(
        api, nodeId, 'memory_import', { name: agentName, ids: [...picked] }, () => !alive.current);
      if (!alive.current) return;
      setPhase({ kind: 'receipt', receipt: data.receipt });
      onChanged?.();
    } catch (e) {
      if (!alive.current) return;
      toast.error(t('memoryImport.importFailed', { message: errorText(e) }));
      setPhase({ kind: 'review', scan: current });
    }
  };

  const doUndo = async () => {
    if (!(await confirm({ title: t('memoryImport.undo'), description: t('memoryImport.undoConfirm', { agent: agentName }), destructive: true }))) return;
    setUndoing(true);
    try {
      await runNodeCommand(api, nodeId, 'memory_undo', { name: agentName }, () => !alive.current);
      toast.success(t('memoryImport.undone'));
      onChanged?.();
      if (alive.current) await scan();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      if (alive.current) setUndoing(false);
    }
  };

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const body = (() => {
    if (phase.kind === 'scanning') {
      return (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('memoryImport.scanning', { tool, device: deviceName || '—' })}
        </div>
      );
    }
    if (phase.kind === 'error') {
      return (
        <div className="space-y-3 py-6 text-center text-xs">
          <p className="text-muted-foreground">{phase.message}</p>
          <Button variant="outline" size="sm" onClick={scan}>{t('memoryImport.retry')}</Button>
        </div>
      );
    }
    if (phase.kind === 'receipt') {
      const r = phase.receipt;
      return (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-green-500/10 px-3 py-2.5 text-xs text-green-800 dark:text-green-300">
            <Check className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-0.5">
              <div className="font-medium">{t('memoryImport.receiptTitle')}</div>
              <div>{t('memoryImport.receiptBody', { agent: agentName, count: r.items.length, tool: r.tool || tool, files: r.files })}</div>
            </div>
          </div>
          <ul className="space-y-1 text-xs">
            {r.items.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <Check className="size-3 shrink-0 text-green-600 dark:text-green-400" />
                <span className="truncate">{i.label}</span>
                <KindBadge kind={i.kind} />
                <span className="ml-auto shrink-0 text-muted-foreground">{t('memoryImport.files', { count: i.files })}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    const s = phase.scan;
    if (!s.supported) return <p className="py-6 text-center text-xs text-muted-foreground">{t('memoryImport.unsupported')}</p>;
    const groups: { key: MemoryScanItem['status']; title: string }[] = [
      { key: 'importable', title: t('memoryImport.groupImportable') },
      { key: 'imported', title: t('memoryImport.groupImported') },
      { key: 'loaded', title: t('memoryImport.groupLoaded') },
      { key: 'skipped', title: t('memoryImport.groupSkipped') },
    ];
    const importable = s.items.filter((i) => i.status === 'importable');
    return (
      <div className="space-y-4">
        {importable.length === 0 && (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">{t('memoryImport.nothingFound')}</p>
        )}
        {groups.map((g) => {
          const list = s.items.filter((i) => i.status === g.key);
          if (!list.length) return null;
          return (
            <section key={g.key} className="space-y-1.5">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.title}</h4>
              {list.map((item) => (
                <ItemRow key={item.id} item={item} checked={picked.has(item.id)} onToggle={phase.kind === 'review' ? () => toggle(item.id) : undefined} />
              ))}
            </section>
          );
        })}
      </div>
    );
  })();

  const hasImported = (phase.kind === 'review' && (phase.scan.items.some((i) => i.status === 'imported'))) || phase.kind === 'receipt';
  const chosen = phase.kind === 'review' || phase.kind === 'importing'
    ? phase.scan.items.filter((i) => i.status === 'importable' && picked.has(i.id)).length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Brain className="size-4" />{t('memoryImport.dialogTitle', { agent: agentName })}</DialogTitle>
          <DialogDescription>{t('memoryImport.dialogIntro', { agent: agentName, tool })}</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto">{body}</DialogBody>
        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {hasImported && (
              <Button variant="ghost" size="sm" onClick={doUndo} disabled={undoing} className="text-muted-foreground">
                {undoing ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
                {undoing ? t('memoryImport.undoing') : t('memoryImport.undo')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {phase.kind === 'receipt' ? (
              <Button size="sm" onClick={() => onOpenChange(false)}>{t('memoryImport.done')}</Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('memoryImport.cancel')}</Button>
                {(phase.kind === 'review' || phase.kind === 'importing') && phase.scan.supported && (
                  <Button size="sm" disabled={chosen === 0 || phase.kind === 'importing'} onClick={() => doImport(phase.scan)}>
                    {phase.kind === 'importing' && <Loader2 className="size-3.5 animate-spin" />}
                    {phase.kind === 'importing' ? t('memoryImport.importing') : t('memoryImport.importButton', { count: chosen })}
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The thread banner shown right after an agent connects, while its device
 * reports memory it could still bring over. "Not now" tells the device, so the
 * offer does not follow the user to every thread; the agent page keeps it.
 */
export function MemoryImportBanner({ api, nodeId, deviceName, agentName, agentType, summary, onChanged }: {
  api: MemoryImportApi;
  nodeId: string;
  deviceName?: string | null;
  agentName: string;
  agentType: string;
  summary: NodeMemorySummary;
  onChanged?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const dismiss = async () => {
    setHidden(true);
    try { await api.enqueueNodeCommand(nodeId, 'memory_dismiss', { name: agentName }); } catch { /* offer returns next visit */ }
  };
  return (
    <>
      <div role="status" className="flex shrink-0 items-start gap-2 border-b bg-brand/5 px-2 lg:px-4 py-2 text-xs">
        <Brain className="mt-0.5 size-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t('memoryImport.bannerTitle', { agent: agentName })}</div>
          <div className="text-muted-foreground">{t('memoryImport.bannerBody', { count: summary.found, tool: summary.tool })}</div>
        </div>
        <Button size="sm" className="h-7 shrink-0 px-2.5 text-xs" onClick={() => setOpen(true)}>{t('memoryImport.review')}</Button>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs text-muted-foreground" onClick={dismiss}>{t('memoryImport.notNow')}</Button>
      </div>
      {open && <MemoryImportDialog
        api={api}
        nodeId={nodeId}
        deviceName={deviceName}
        agentName={agentName}
        agentType={agentType}
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) onChanged?.(); }}
        onChanged={onChanged}
      />}
    </>
  );
}

/** The Memory section of an agent's page: status, and the way back in. */
export function MemoryPanel({ api, nodeId, deviceName, agentName, agentType, summary, onChanged }: {
  api: MemoryImportApi;
  nodeId: string;
  deviceName?: string | null;
  agentName: string;
  agentType: string;
  summary: NodeMemorySummary | null | undefined;
  onChanged?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const tool = summary?.tool || TOOL_LABEL[agentType] || agentType;
  const line = !summary
    ? t('memoryImport.panelUnknown', { tool })
    : summary.status === 'imported' && summary.importedAt
      ? t('memoryImport.panelImported', { tool, date: new Date(summary.importedAt).toLocaleDateString() })
      : summary.found > 0
        ? t('memoryImport.panelAvailable', { count: summary.found, tool })
        : t('memoryImport.panelNone', { tool });
  return (
    <div className="rounded-xl border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs">
          <div className="flex items-center gap-1.5 font-medium"><Brain className="size-3.5" />{t('memoryImport.panelTitle')}</div>
          <div className={cn('mt-0.5', summary?.found && summary.status !== 'imported' ? 'text-foreground' : 'text-muted-foreground')}>{line}</div>
        </div>
        <Button variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-xs" onClick={() => setOpen(true)}>
          {summary?.status === 'imported' || !summary?.found ? t('memoryImport.panelReview') : t('memoryImport.panelOpen')}
        </Button>
      </div>
      {open && <MemoryImportDialog
        api={api}
        nodeId={nodeId}
        deviceName={deviceName}
        agentName={agentName}
        agentType={agentType}
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) onChanged?.(); }}
        onChanged={onChanged}
      />}
    </div>
  );
}
