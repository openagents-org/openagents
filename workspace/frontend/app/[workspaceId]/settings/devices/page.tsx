'use client';

import { useCallback, useEffect, useState } from 'react';
import { Laptop, Loader2, RefreshCw, Ticket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import type { PairingCode, WorkspaceNode } from '@/lib/types';
import { useT } from '@/lib/i18n';

export default function DevicesSettingsPage() {
  const { me } = useAdminSettings();
  const t = useT();
  const confirm = useConfirm();
  const editable = canAdminister(me);

  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [minting, setMinting] = useState(false);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      setNodes(await workspaceApi.listNodes());
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNodes(); }, [loadNodes]);

  const mintCode = async () => {
    setMinting(true);
    try {
      setPairing(await workspaceApi.createPairingCode());
    } catch {
      toast.error(t('admin.pairingFailed'));
    } finally {
      setMinting(false);
    }
  };

  const forget = async (node: WorkspaceNode) => {
    const ok = await confirm({
      title: t('admin.forgetTitle'),
      description: t('admin.forgetDescription', { name: node.name || node.hostname || node.nodeId }),
      confirmText: t('admin.forgetDevice'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.deleteNode(node.nodeId);
      await loadNodes();
      toast.success(t('admin.forgotten'));
    } catch {
      toast.error(t('admin.forgetFailed'));
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader title={t('admin.devicesTitle')} description={t('admin.devicesDescription')} />
      {!editable && <ReadOnlyBanner />}

      {editable && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Ticket className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t('admin.generatePairingCode')}</span>
            </div>
            <Button size="sm" onClick={mintCode} disabled={minting}>
              {minting ? <Loader2 className="size-4 animate-spin" /> : t('admin.generatePairingCode')}
            </Button>
          </div>
          {pairing && (
            <div className="space-y-1 rounded-md bg-muted/40 p-3 text-center">
              <p className="font-mono text-2xl font-semibold tracking-[0.3em]">{pairing.code}</p>
              <p className="text-xs text-muted-foreground">
                {t('admin.pairingCodeHint', {
                  minutes: Math.max(1, Math.round(pairing.expiresInSeconds / 60)),
                })}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('admin.navDevices')}</span>
          <Button variant="ghost" size="sm" onClick={loadNodes} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.refreshList')}
          </Button>
        </div>

        {loading && nodes.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : nodes.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t('admin.noDevices')}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {nodes.map((n) => (
              <div key={n.nodeId} className="flex items-center gap-3 px-4 py-3">
                <Laptop className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {n.name || n.hostname || n.nodeId}
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        n.status === 'online' ? 'bg-emerald-500' : 'bg-zinc-400'
                      }`}
                      title={n.status}
                    />
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[n.os, n.launcherVersion && `v${n.launcherVersion}`,
                      t('admin.agentsOnNode', { count: n.agents.length }),
                      n.lastHeartbeatAt &&
                        t('admin.lastSeen', { time: new Date(n.lastHeartbeatAt).toLocaleString() }),
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => forget(n)}
                    title={t('admin.forgetDevice')}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
