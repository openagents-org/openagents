'use client';

import { useCallback, useEffect, useState } from 'react';
import { Laptop, RefreshCw, Ticket, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { IconAction } from '@/components/settings/icon-action';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty, ListLoading, SettingsList } from '@/components/settings/settings-list';
import { workspaceApi } from '@/lib/api';
import type { PairingCode, WorkspaceNode } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { desktopHost } from '@/lib/desktop-host';

export default function DevicesSettingsPage() {
  const { me, workspace } = useAdminSettings();
  const host = desktopHost();
  const [connecting, setConnecting] = useState(false);
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

  const connectComputer = async () => {
    if (!host || connecting) return;
    const ok = await confirm({
      title: t('admin.connectThisComputer'),
      description: t('admin.connectThisComputerDescription'),
      confirmText: t('admin.connectThisComputer'),
    });
    if (!ok) return;
    setConnecting(true);
    try {
      await host.connectComputer(workspace.workspaceId);
      await loadNodes();
      toast.success(t('admin.computerConnected'));
    } catch { toast.error(t('admin.pairingFailed')); }
    finally { setConnecting(false); }
  };

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
    <div className="flex flex-col gap-6">
      <SectionHeader title={t('admin.devicesTitle')} description={t('admin.devicesDescription')} />
      {!editable && <ReadOnlyBanner />}

      {editable && host && (
        <SettingsCard
          title={t('admin.connectThisComputer')}
          description={t('admin.connectThisComputerHint')}
          action={(
            <Button size="sm" onClick={connectComputer} disabled={connecting}>
              {connecting ? <Spinner data-icon="inline-start" /> : <Laptop data-icon="inline-start" />}
              {t('admin.connectThisComputer')}
            </Button>
          )}
        />
      )}

      {editable && (
        <SettingsCard
          title={t('admin.generatePairingCode')}
          action={(
            <Button size="sm" variant="outline" onClick={mintCode} disabled={minting}>
              {minting ? <Spinner data-icon="inline-start" /> : <Ticket data-icon="inline-start" />}
              {t('admin.generatePairingCode')}
            </Button>
          )}
        >
          {pairing && (
            <div className="flex flex-col gap-1 rounded-lg bg-muted p-4 text-center">
              <p className="font-mono text-2xl font-semibold tracking-widest">{pairing.code}</p>
              <p className="text-xs text-muted-foreground">
                {t('admin.pairingCodeHint', {
                  minutes: Math.max(1, Math.round(pairing.expiresInSeconds / 60)),
                })}
              </p>
            </div>
          )}
        </SettingsCard>
      )}

      <SettingsCard
        title={t('admin.navDevices')}
        action={(
          <Button variant="ghost" size="sm" onClick={loadNodes} disabled={loading}>
            <RefreshCw data-icon="inline-start" className={loading ? 'animate-spin' : undefined} />
            {t('admin.refreshList')}
          </Button>
        )}
      >
        {loading && nodes.length === 0 ? (
          <ListLoading />
        ) : nodes.length === 0 ? (
          <ListEmpty icon={<Laptop />}>{t('admin.noDevices')}</ListEmpty>
        ) : (
          <SettingsList>
            {nodes.map((n) => (
              <Item key={n.nodeId} size="sm">
                <ItemMedia variant="icon">
                  <Laptop className="size-5 text-muted-foreground" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <span className="truncate">{n.name || n.hostname || n.nodeId}</span>
                    <Badge variant={n.status === 'online' ? 'success' : 'secondary'}>
                      {n.status === 'online' ? t('agents.online') : t('agents.offline')}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-1 text-xs">
                    {[n.os, n.launcherVersion && `v${n.launcherVersion}`,
                      t('admin.agentsOnNode', { count: n.agents.length }),
                      n.lastHeartbeatAt &&
                        t('admin.lastSeen', { time: new Date(n.lastHeartbeatAt).toLocaleString() }),
                    ].filter(Boolean).join(' · ')}
                  </ItemDescription>
                </ItemContent>
                {editable && (
                  <ItemActions>
                    <IconAction label={t('admin.forgetDevice')} destructive onClick={() => forget(n)}>
                      <Trash2 />
                    </IconAction>
                  </ItemActions>
                )}
              </Item>
            ))}
          </SettingsList>
        )}
      </SettingsCard>
    </div>
  );
}
