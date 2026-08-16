'use client';

import { useState } from 'react';
import { Check, Copy, Eye, EyeOff, Shield, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
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
  const { isCopied, copyToClipboard } = useCopyToClipboard();

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
    <div className="space-y-8">
      <SectionHeader title={t('admin.securityTitle')} description={t('admin.securityDescription')} />
      {!editable && <ReadOnlyBanner />}

      {/* Enforced login */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('admin.requireLogin')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.requireLoginHint')}</p>
        </div>
        <Switch checked={requireLogin} onCheckedChange={toggleRequireLogin} disabled={!editable} />
      </div>

      {/* Workspace token (only shown when the visitor holds it) */}
      {token && (
        <div className="space-y-2 rounded-lg border p-4">
          <Label>{t('admin.workspaceToken')}</Label>
          <div className="flex items-center gap-2">
            <Input
              value={showToken ? token : '•'.repeat(24)}
              readOnly
              className="font-mono text-xs"
            />
            <Button variant="outline" size="icon" onClick={() => setShowToken((v) => !v)}>
              {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={() => copyToClipboard(token)}>
              {isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.workspaceTokenHint')}</p>
        </div>
      )}

      {/* Ownership — display only; login is enforced, so workspaces get an
          owner at creation. The Members section handles owner transfer. */}
      <div className="space-y-2 rounded-lg border p-4">
        <div className="flex items-center gap-1.5">
          <Shield className="size-4 text-muted-foreground" />
          <Label>{t('admin.claimTitle')}</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          {workspace.creatorEmail
            ? t('admin.claimedBy', { email: workspace.creatorEmail })
            : t('admin.unclaimed')}
        </p>
      </div>
    </div>
  );
}
