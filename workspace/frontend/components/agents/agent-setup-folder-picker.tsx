'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Folder, CornerLeftUp, HardDrive } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { WorkspaceNode } from '@/lib/types';
import { joinNodePath } from '@/lib/node-path';
import { AgentSetupApi } from './agent-setup';

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
export function FolderPicker({
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
        <span className="text-xs font-medium truncate">{t('connect.nodePickerTitle')}</span>
        <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>

      {/* Current path */}
      <div className="px-3 py-2 border-b bg-zinc-950 dark:bg-black">
        <code className="text-xs font-mono text-zinc-100 break-all">{path || '—'}</code>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Spinner /><span className="text-xs">{t('connect.nodePickerLoading')}</span>
          </div>
        ) : unavailable ? (
          <p className="text-xs text-muted-foreground px-3 py-6 text-center">{t('connect.nodePickerUnavailable')}</p>
        ) : (
          <div className="py-1">
            {roots.length > 0 && (
              <div className="px-3 py-2 border-b mb-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  {t('connect.nodePickerLocations')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {roots.map((root) => (
                    <button
                      key={root}
                      onClick={() => browse(root)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-mono transition-colors hover:bg-muted/60',
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
              <p className="text-xs text-muted-foreground px-3 py-6 text-center">{t('connect.nodePickerEmpty')}</p>
            ) : (
              dirs.map((d) => (
                <button
                  key={d}
                  onClick={() => path && browse(joinNodePath(path, d))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 transition-colors"
                >
                  <Folder className="size-4 text-info" /><span className="truncate">{d}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>{t('connect.nodeCancel')}</Button>
        <Button size="sm" disabled={!path} onClick={() => { if (path) { onPick(path); onClose(); } }}>
          {t('connect.nodePickerUseThis')}
        </Button>
      </div>
    </div>
  );
}
