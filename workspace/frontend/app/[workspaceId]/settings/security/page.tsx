'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { FieldContent, FieldDescription, FieldSeparator, FieldTitle, Field } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { CopyInput, InputGroupAction } from '@/components/settings/copy-input';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard, SettingsRow } from '@/components/settings/settings-card';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function SecuritySettingsPage() {
  // `token` is the resolved machine credential (?token= link, cookie, or the
  // signed-in user's account) — '' when accessing via identity bearer only.
  const { workspace, me, token, refreshWorkspace } = useAdminSettings();
  const t = useT();
  const editable = canAdminister(me);

  const [requireLogin, setRequireLogin] = useState(workspace.requireLogin);
  const [showToken, setShowToken] = useState(false);

  const toggleRequireLogin = async (next: boolean) => {
    setRequireLogin(next); // optimistic
    try {
      await workspaceApi.updateWorkspace({ require_login: next });
      await refreshWorkspace();
      toast.success(next ? t('admin.requireLoginOn') : t('admin.requireLoginOff'));
    } catch {
      setRequireLogin(!next); // revert
      toast.error(t('admin.requireLoginFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t('admin.securityTitle')} description={t('admin.securityDescription')} />
      {!editable && <ReadOnlyBanner />}

      <SettingsCard title={t('admin.securityCardTitle')}>
        <SettingsRow label={t('admin.requireLogin')} description={t('admin.requireLoginHint')} htmlFor="security-require-login">
          <Switch
            id="security-require-login"
            checked={requireLogin}
            onCheckedChange={toggleRequireLogin}
            disabled={!editable}
          />
        </SettingsRow>

        {/* Workspace token (only shown when the visitor holds it) */}
        {token && (
          <>
            <FieldSeparator />
            <SettingsRow label={t('admin.workspaceToken')} description={t('admin.workspaceTokenHint')} htmlFor="security-workspace-token">
              <CopyInput
                id="security-workspace-token"
                value={token}
                display={showToken ? token : '•'.repeat(24)}
                actions={(
                  <InputGroupAction
                    label={showToken ? t('admin.hideToken') : t('admin.showToken')}
                    onClick={() => setShowToken((v) => !v)}
                  >
                    {showToken ? <EyeOff /> : <Eye />}
                  </InputGroupAction>
                )}
              />
            </SettingsRow>
          </>
        )}

        {/* Ownership — display only; login is enforced, so workspaces get an
            owner at creation. The Members section handles owner transfer. */}
        <FieldSeparator />
        <Field>
          <FieldContent>
            <FieldTitle>{t('admin.claimTitle')}</FieldTitle>
            <FieldDescription>
              {workspace.creatorEmail
                ? t('admin.claimedBy', { email: workspace.creatorEmail })
                : t('admin.unclaimed')}
            </FieldDescription>
          </FieldContent>
        </Field>
      </SettingsCard>
    </div>
  );
}
