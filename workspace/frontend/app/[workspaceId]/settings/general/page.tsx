'use client';

import { useState } from 'react';
import { Check, Copy, Languages } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { LOCALES, LOCALE_LABELS, isLocale, useI18n } from '@/lib/i18n';

export default function GeneralSettingsPage() {
  const { workspace, me, refreshWorkspace } = useAdminSettings();
  const { t, locale, setLocale, isAutoDetected } = useI18n();
  const editable = canAdminister(me);

  const [name, setName] = useState(workspace.name);
  const [monitorMode, setMonitorMode] = useState(!!workspace.settings?.monitorMode);
  const [saving, setSaving] = useState(false);
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: idCopied, copyToClipboard: copyId } = useCopyToClipboard();

  // Deliberately without any ?token= — links we surface for sharing must
  // never carry the workspace machine token (use invite links instead).
  const workspaceUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${workspace.slug}`
    : '';

  const dirty = name.trim() !== workspace.name || monitorMode !== !!workspace.settings?.monitorMode;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({
        name: name.trim(),
        settings: { ...workspace.settings, monitorMode },
      });
      await refreshWorkspace();
      toast.success(t('settings.saved'));
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader title={t('admin.generalTitle')} description={t('admin.generalDescription')} />
      {!editable && <ReadOnlyBanner />}

      <div className="space-y-2">
        <Label>{t('settings.workspaceName')}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.workspaceNamePlaceholder')}
          disabled={!editable}
        />
      </div>

      {/* Language — applies immediately for this browser; not part of Save. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Languages className="size-4 text-muted-foreground" />
          <Label>{t('language.label')}</Label>
        </div>
        <div className="flex flex-wrap gap-2">
          {LOCALES.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={option === locale ? 'primary' : 'outline'}
              onClick={() => { if (isLocale(option)) setLocale(option); }}
            >
              {LOCALE_LABELS[option]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {isAutoDetected ? t('language.autoHint') : t('language.description')}
        </p>
      </div>

      <div className="space-y-2">
        <Label variant="secondary">{t('settings.workspaceUrl')}</Label>
        <div className="flex items-center gap-2">
          <Input value={workspaceUrl} readOnly className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={() => copyUrl(workspaceUrl)}>
            {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label variant="secondary">{t('settings.workspaceId')}</Label>
        <div className="flex items-center gap-2">
          <Input value={workspace.slug} readOnly className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={() => copyId(workspace.slug)}>
            {idCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Label>{t('settings.monitorMode')}</Label>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {t('settings.experimental')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.monitorModeHint')}</p>
        </div>
        <Switch checked={monitorMode} onCheckedChange={setMonitorMode} size="sm" disabled={!editable} />
      </div>

      {editable && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !dirty || !name.trim()}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
