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
import { KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { IconAction } from '@/components/settings/icon-action';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty, ListLoading, SettingsList } from '@/components/settings/settings-list';
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
    <div className="flex flex-col gap-6">
      <SectionHeader title={t('admin.modelAccessTitle')} description={t('admin.modelAccessDescription')} />
      {!editable && <ReadOnlyBanner />}

      <SettingsCard
        title={t('admin.modelAccessListTitle')}
        action={(
          <div className="flex items-center gap-1.5">
            <IconAction label={t('common.refresh')} onClick={load} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
            </IconAction>
            {editable && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus data-icon="inline-start" />{t('admin.modelAccessAdd')}
              </Button>
            )}
          </div>
        )}
      >
        {loading && entries.length === 0 ? (
          <ListLoading />
        ) : entries.length === 0 ? (
          <ListEmpty
            icon={<KeyRound />}
            action={editable && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus data-icon="inline-start" />{t('admin.modelAccessAdd')}
              </Button>
            )}
          >
            {t('admin.modelAccessEmpty')}
          </ListEmpty>
        ) : (
          <SettingsList>
            {entries.map((e) => (
              <Item key={e.id} size="sm">
                <ItemMedia>
                  <ProviderIcon name={e.provider} size={32} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>{e.label}</ItemTitle>
                  <ItemDescription className="line-clamp-1 font-mono text-xs">
                    {[e.provider, e.apiKeyMasked, e.baseUrl].filter(Boolean).join(' · ')}
                  </ItemDescription>
                </ItemContent>
                {editable && (
                  <ItemActions>
                    <IconAction label={t('admin.modelAccessDelete')} destructive onClick={() => remove(e)}>
                      <Trash2 />
                    </IconAction>
                  </ItemActions>
                )}
              </Item>
            ))}
          </SettingsList>
        )}
      </SettingsCard>

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
