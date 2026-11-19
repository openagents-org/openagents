'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Field, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAdminSettings } from '@/components/settings/admin-context';
import { SaveButton } from '@/components/settings/save-button';
import { SettingsCard } from '@/components/settings/settings-card';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** The workspace's BrowserFabric key: only ever replaced, never shown back in full. */
export function BrowserFabricKeyCard({ editable }: { editable: boolean }) {
  const { workspace, refreshWorkspace } = useAdminSettings();
  const t = useT();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const current = workspace.browserfabricApiKey;

  const save = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({ browserfabric_api_key: apiKey.trim() });
      await refreshWorkspace();
      setApiKey('');
      toast.success(t('settings.saved'));
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard
      title={t('settings.browserFabricKey')}
      description={current && <span className="font-mono text-xs">{t('settings.browserFabricCurrent', { key: current })}</span>}
      footer={editable && <SaveButton dirty={!!apiKey.trim()} saving={saving} onClick={save} />}
    >
      <Field>
        <Input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={current ? t('settings.browserFabricReplace') : t('settings.browserFabricPlaceholder')}
          aria-label={t('settings.browserFabricKey')}
          className="font-mono text-xs"
          disabled={!editable}
        />
        <FieldDescription>{t('settings.browserFabricHint')}</FieldDescription>
      </Field>
    </SettingsCard>
  );
}
