'use client';

import { useState } from 'react';
import { Globe } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAdminSettings } from '@/components/settings/admin-context';
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
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          {t('settings.browserFabricKey')}
        </CardTitle>
        {current && (
          <CardDescription className="font-mono text-xs">
            {t('settings.browserFabricCurrent', { key: current })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
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
      </CardContent>
      {editable && (
        <CardFooter className="justify-end">
          <Button size="sm" onClick={save} disabled={saving || !apiKey.trim()}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
