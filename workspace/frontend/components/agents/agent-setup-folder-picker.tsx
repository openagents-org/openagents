'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Folder, CornerLeftUp, HardDrive } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import type { WorkspaceNode } from '@/lib/types';
import { joinNodePath } from '@/lib/node-path';
import type { AgentSetupApi } from './agent-setup-types';

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
/** A full-width folder row in the list. */
const ROW = 'w-full justify-start rounded-none px-3 text-xs font-normal';

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
    <div className="overflow-hidden rounded-xl border bg-background animate-in duration-150 fade-in slide-in-from-top-1">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
        <span className="truncate text-xs font-medium">{t('connect.nodePickerTitle')}</span>
        <Button variant="ghost" size="icon-xs" onClick={onClose} className="text-muted-foreground" aria-label={t('connect.nodeCancel')}><X /></Button>
      </div>

      {/* Current path */}
      <div className="border-b bg-muted px-3 py-2">
        <code className="font-mono text-xs break-all">{path || '—'}</code>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Spinner /><span className="text-xs">{t('connect.nodePickerLoading')}</span>
          </div>
        ) : unavailable ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('connect.nodePickerUnavailable')}</p>
        ) : (
          <div className="py-1">
            {roots.length > 0 && (
              <div className="mb-1 flex flex-col gap-1.5 border-b px-3 py-2">
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t('connect.nodePickerLocations')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {roots.map((root) => (
                    <Button
                      key={root}
                      variant={path === root ? 'secondary' : 'outline'}
                      size="xs"
                      aria-pressed={path === root}
                      onClick={() => browse(root)}
                      className="font-mono"
                    >
                      <HardDrive data-icon="inline-start" className="text-muted-foreground" />{root}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {parent && (
              <Button variant="ghost" size="sm" onClick={() => browse(parent)} className={ROW}>
                <CornerLeftUp data-icon="inline-start" className="text-muted-foreground" />{t('connect.nodePickerUp')}
              </Button>
            )}
            {dirs.length === 0 && !parent ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('connect.nodePickerEmpty')}</p>
            ) : (
              dirs.map((d) => (
                <Button key={d} variant="ghost" size="sm" onClick={() => path && browse(joinNodePath(path, d))} className={ROW}>
                  <Folder data-icon="inline-start" className="text-muted-foreground" /><span className="truncate">{d}</span>
                </Button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onClose}>{t('connect.nodeCancel')}</Button>
        <Button size="sm" disabled={!path} onClick={() => { if (path) { onPick(path); onClose(); } }}>
          {t('connect.nodePickerUseThis')}
        </Button>
      </div>
    </div>
  );
}
