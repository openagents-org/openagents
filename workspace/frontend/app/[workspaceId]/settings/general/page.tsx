'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Switch } from '@/components/ui/switch';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard, SettingsRow } from '@/components/settings/settings-card';
import { SaveButton } from '@/components/settings/save-button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { shareOrigin } from '@/lib/share-origin';

type Part = 'name' | 'monitor' | 'services';

/** A read-only value with a copy button inside the field. */
function CopyField({ id, value, label }: { id: string; value: string; label: string }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <InputGroup className="@md/field-group:w-80">
      <InputGroupInput id={id} value={value} readOnly className="font-mono text-xs" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label={label} title={label} onClick={() => copyToClipboard(value)}>
          {isCopied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export default function GeneralSettingsPage() {
  const { workspace, me, refreshWorkspace } = useAdminSettings();
  const t = useT();
  const editable = canAdminister(me);

  const [name, setName] = useState(workspace.name);
  const [monitorMode, setMonitorMode] = useState(!!workspace.settings?.monitorMode);
  const [servicesEnabled, setServicesEnabled] = useState(workspace.settings?.services_enabled === true);
  const [saving, setSaving] = useState<Part | null>(null);

  // Deliberately without any ?token= — links we surface for sharing must
  // never carry the workspace machine token (use invite links instead).
  const workspaceUrl = typeof window !== 'undefined'
    ? `${shareOrigin()}/${workspace.slug}`
    : '';

  const nameDirty = name.trim() !== workspace.name;
  const servicesDirty = servicesEnabled !== (workspace.settings?.services_enabled === true);
  const monitorDirty = monitorMode !== !!workspace.settings?.monitorMode;

  // Each card saves only its own part, so an unsaved edit in another card is
  // never sent along with it.
  const save = async (part: Part) => {
    if (part === 'name' && !name.trim()) return;
    setSaving(part);
    try {
      await workspaceApi.updateWorkspace(
        part === 'name'
          ? { name: name.trim() }
          : { settings: part === 'services' ? { services_enabled: servicesEnabled } : { monitorMode } },
      );
      await refreshWorkspace();
      toast.success(t('settings.saved'));
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t('admin.generalTitle')} description={t('admin.generalDescription')} />
      {!editable && <ReadOnlyBanner />}

      <SettingsCard
        title={t('settings.workspaceName')}
        description={t('admin.workspaceNameHint')}
        footer={editable && (
          <SaveButton dirty={nameDirty} saving={saving === 'name'} disabled={!name.trim()} onClick={() => save('name')} />
        )}
      >
        <Input
          aria-label={t('settings.workspaceName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && nameDirty && name.trim()) void save('name'); }}
          placeholder={t('settings.workspaceNamePlaceholder')}
          disabled={!editable}
          className="max-w-sm"
        />
      </SettingsCard>

      <SettingsCard title={t('admin.workspaceLinksTitle')} description={t('admin.workspaceLinksHint')}>
        <SettingsRow label={t('settings.workspaceUrl')} htmlFor="general-workspace-url">
          <CopyField id="general-workspace-url" value={workspaceUrl} label={t('common.copy')} />
        </SettingsRow>
        <SettingsRow label={t('settings.workspaceId')} htmlFor="general-workspace-id">
          <CopyField id="general-workspace-id" value={workspace.slug} label={t('common.copy')} />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        title={t('settings.services')}
        description={t('settings.servicesHint')}
        footer={editable && (
          <SaveButton dirty={servicesDirty} saving={saving === 'services'} onClick={() => save('services')} />
        )}
      >
        <SettingsRow label={t('settings.enableServices')} htmlFor="general-services-enabled">
          <Switch id="general-services-enabled" checked={servicesEnabled} onCheckedChange={setServicesEnabled} disabled={!editable} />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        title={t('settings.experimental')}
        footer={editable && (
          <SaveButton dirty={monitorDirty} saving={saving === 'monitor'} onClick={() => save('monitor')} />
        )}
      >
        <SettingsRow label={t('settings.monitorMode')} description={t('settings.monitorModeHint')} htmlFor="general-monitor-mode">
          <Switch id="general-monitor-mode" checked={monitorMode} onCheckedChange={setMonitorMode} disabled={!editable} />
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
