'use client';

import { useState } from 'react';
import { Globe } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function IntegrationsSettingsPage() {
  const { workspace, me, refreshWorkspace } = useAdminSettings();
  const t = useT();
  const editable = canAdminister(me);

  const [bfApiKey, setBfApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!bfApiKey.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({ browserfabric_api_key: bfApiKey.trim() });
      await refreshWorkspace();
      setBfApiKey('');
      toast.success(t('settings.saved'));
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        title={t('admin.integrationsTitle')}
        description={t('admin.integrationsDescription')}
      />
      {!editable && <ReadOnlyBanner />}

      <div className="space-y-2 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <Label>{t('settings.browserFabricKey')}</Label>
        </div>
        {workspace.browserfabricApiKey && (
          <p className="font-mono text-xs text-muted-foreground">
            {t('settings.browserFabricCurrent', { key: workspace.browserfabricApiKey })}
          </p>
        )}
        <Input
          value={bfApiKey}
          onChange={(e) => setBfApiKey(e.target.value)}
          placeholder={
            workspace.browserfabricApiKey
              ? t('settings.browserFabricReplace')
              : t('settings.browserFabricPlaceholder')
          }
          className="font-mono text-xs"
          disabled={!editable}
        />
        <p className="text-xs text-muted-foreground">{t('settings.browserFabricHint')}</p>
        {editable && (
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving || !bfApiKey.trim()}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
