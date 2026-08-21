'use client';

/**
 * Model access — saved inference credentials for this workspace.
 *
 * Each entry is a provider + API key (with an optional custom endpoint) that
 * agent configs reference by id — the raw key stays server-side after it is
 * saved here. The add dialog validates the key live (list models + one-shot
 * completion) before saving.
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { ProviderIcon } from '@/components/icons/agent-icons';
import { AddModelAccessDialog } from '@/components/settings/model-access-dialog';
import { workspaceApi } from '@/lib/api';
import type { CloudAgentProvider, ModelAccessEntry } from '@/lib/types';
import { useT } from '@/lib/i18n';

export default function ModelAccessSettingsPage() {
  const { me } = useAdminSettings();
  const t = useT();
  const confirm = useConfirm();
  const editable = canAdminister(me);

  const [entries, setEntries] = useState<ModelAccessEntry[]>([]);
  const [providers, setProviders] = useState<CloudAgentProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await workspaceApi.listModelAccess());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    workspaceApi.getCloudProviders().then(setProviders).catch(() => {});
  }, [load]);

  const remove = async (entry: ModelAccessEntry) => {
    const ok = await confirm({
      title: t('admin.modelAccessDeleteTitle'),
      description: t('admin.modelAccessDeleteBody', { label: entry.label }),
      confirmText: t('admin.modelAccessDelete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.deleteModelAccess(entry.id);
      await load();
      toast.success(t('admin.modelAccessDeleted'));
    } catch {
      toast.error(t('admin.modelAccessDeleteFailed'));
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader title={t('admin.modelAccessTitle')} description={t('admin.modelAccessDescription')} />
      {!editable && <ReadOnlyBanner />}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('admin.modelAccessListTitle')}</span>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {editable && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5 mr-1" />{t('admin.modelAccessAdd')}
              </Button>
            )}
          </div>
        </div>

        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center">
            <KeyRound className="mx-auto size-6 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">{t('admin.modelAccessEmpty')}</p>
            {editable && (
              <Button size="sm" className="mt-3" onClick={() => setAdding(true)}>
                <Plus className="size-3.5 mr-1" />{t('admin.modelAccessAdd')}
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10 shrink-0">
                  <ProviderIcon name={e.provider} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.label}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {[e.provider, e.apiKeyMasked, e.baseUrl].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {editable && (
                  <Button variant="ghost" size="icon" onClick={() => remove(e)} title={t('admin.modelAccessDelete')}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <AddModelAccessDialog
          providers={providers}
          createdBy={me?.email ?? undefined}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }}
        />
      )}
    </div>
  );
}
