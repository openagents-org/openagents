'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Lock, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CodeBlock, CodeBlockContent } from '@/components/ui/code-block';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { toast } from 'sonner';
import { CustomPolicyEditor, type CustomPolicy } from '@/components/settings/custom-policy-editor';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner } from '@/components/settings/section-chrome';
import { SaveButton } from '@/components/settings/save-button';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty, ListLoading, SettingsList } from '@/components/settings/settings-list';
import { workspaceApi } from '@/lib/api';
import { canActOnApproval } from '@/lib/approvals';
import { threadPath } from '@/lib/thread-link';
import { useFormatters, useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/translate';
import type { ApprovalPolicyRule, ApprovalRequest } from '@/lib/types';

const KIND_KEYS: Record<string, MessageKey> = {
  service_request: 'approvals.kinds.service_request',
  deploy: 'approvals.kinds.deploy',
  spend: 'approvals.kinds.spend',
  external_send: 'approvals.kinds.external_send',
  repo_read: 'approvals.kinds.repo_read',
  repo_write: 'approvals.kinds.repo_write',
  data_delete: 'approvals.kinds.data_delete',
  shell: 'approvals.kinds.shell',
  other: 'approvals.kinds.generic',
};

/**
 * Settings → Approvals: what pauses for a person, and who that person must be.
 *
 * Policies added by an admin and pending requests live in separate tabs.
 * Requests can be resolved here or in the thread through the same endpoint.
 */
export default function ApprovalsSettingsPage() {
  const { workspaceId, workspace, me, query } = useAdminSettings();
  const t = useT();
  const { timeAgoShort } = useFormatters();
  const editable = canAdminister(me);

  // ── Pending queue ──
  const [pending, setPending] = useState<ApprovalRequest[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadPending = useCallback(async () => {
    try {
      const r = await workspaceApi.listApprovals({ status: 'pending', limit: 100 });
      setPending(r.approvals);
    } catch {
      setPending([]);
    }
  }, []);
  useEffect(() => { loadPending(); }, [loadPending]);

  const decide = async (a: ApprovalRequest, decision: 'approve' | 'reject') => {
    setBusyId(a.id);
    try {
      const updated = await workspaceApi.resolveApproval(a.id, decision);
      setPending((prev) => (prev || []).flatMap((x) => x.id !== a.id ? [x] : updated.status === 'pending' ? [updated] : []));
    } catch {
      toast.error(t('approvals.failed'));
    } finally {
      setBusyId(null);
    }
  };

  // ── Policy ──
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [custom, setCustom] = useState<CustomPolicy[]>([]);
  const [savedCustom, setSavedCustom] = useState<CustomPolicy[]>([]);
  const applyPolicy = (allRules: ApprovalPolicyRule[]) => {
    const added = allRules.filter((r) => r.description).map(({ kind, description, policy, approver_email }) => ({ approver_email, kind: kind.startsWith('custom:') ? kind : `custom:legacy:${kind}`, description: description!, policy })) as CustomPolicy[];
    setLoaded(true);
    setLoadFailed(false);
    setCustom(added);
    setSavedCustom(added);
  };
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    workspaceApi.getApprovalPolicy()
      .then((p) => {
        applyPolicy(p.rules);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(custom) !== JSON.stringify(savedCustom),
    [custom, savedCustom],
  );
  // A condition left blank, or a "specific member" policy with nobody picked.
  const invalid = custom.some((r) => (!r.description.trim() || (r.policy === 'member' && !r.approver_email)));

  const save = async () => {
    if (!editable || !loaded || invalid) return;
    setSaving(true);
    try {
      const p = await workspaceApi.updateApprovalPolicy(custom);
      applyPolicy(p.rules);
      toast.success(t('approvals.saved'));
    } catch {
      toast.error(t('approvals.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const roleText = (r: ApprovalRequest['requiredRole']) =>
    r === 'admin' ? t('approvals.roleAdmin') : r === 'owner' ? t('approvals.roleOwner') : t('approvals.roleAny');
  const needs = (a: ApprovalRequest) => a.policyRequirements?.members.length
    ? a.policyRequirements.members.join(', ') + (a.policyRequirements.role_required ? ` + ${roleText(a.policyRequirements.role_required)}` : '')
    : roleText(a.requiredRole);
  const openThread = async (a: ApprovalRequest) => {
    try {
      const link = await workspaceApi.getThreadLink(a.channelName);
      window.location.assign(`${threadPath(workspaceId, link.id)}${query}`);
    } catch { toast.error(t('share.threadUnavailable')); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">{t('admin.approvalsTitle')}</h2>
        <Alert role="note">
          <AlertTriangle aria-hidden="true" className="text-warning" />
          <AlertTitle>{t('approvals.advisoryWarning')}</AlertTitle>
          <AlertDescription>{t('admin.approvalsDescription')}</AlertDescription>
        </Alert>
      </div>
      {!editable && <ReadOnlyBanner />}

      <Tabs defaultValue="policy" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="policy">{t('approvals.policyTitle')}</TabsTrigger>
          <TabsTrigger value="pending">
            {t('approvals.pendingTab')}
            {!!pending?.length && <Badge variant="secondary">{pending.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <SettingsCard
            title={t('approvals.pendingTitle')}
            action={!!pending?.length && <Badge variant="warning">{pending.length}</Badge>}
          >
            {pending === null ? (
              <ListLoading />
            ) : pending.length === 0 ? (
              <ListEmpty icon={<Check />}>{t('approvals.nonePending')}</ListEmpty>
            ) : (
              <SettingsList>
                {pending.map((a) => (
                  <Item key={a.id} size="sm" className="items-start">
                    <ItemMedia variant="icon">
                      <Lock className="text-warning" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="line-clamp-none">{a.action}</ItemTitle>
                      <ItemDescription className="line-clamp-none text-xs">
                        {a.requestedBy} · {t(KIND_KEYS[a.kind] ?? 'approvals.kinds.generic')} · {t('approvals.needs', { role: needs(a) })}
                        {a.createdAt && <> · {timeAgoShort(a.createdAt)}</>}
                      </ItemDescription>
                      {a.details && (
                        <CodeBlock size="sm">
                          <CodeBlockContent wrap className="max-h-24">{a.details}</CodeBlockContent>
                        </CodeBlock>
                      )}
                      {!!a.policyRequirements?.approved_by.length && (
                        <ItemDescription className="line-clamp-none text-xs">
                          {t('approvals.reviewedBy', { people: a.policyRequirements.approved_by.join(', ') })}
                        </ItemDescription>
                      )}
                      {a.note && <ItemDescription className="line-clamp-none text-xs">{a.note}</ItemDescription>}
                      <Button
                        type="button"
                        onClick={() => openThread(a)}
                        variant="link" size="xs" className="h-auto self-start px-0 text-muted-foreground"
                      >
                        {t('approvals.openThread')}
                        <ExternalLink data-icon="inline-end" />
                      </Button>
                    </ItemContent>
                    {canActOnApproval(me, a, workspace.requireLogin) && (
                      <ItemActions>
                        <Button size="sm" disabled={busyId === a.id} onClick={() => decide(a, 'approve')}>
                          <Check data-icon="inline-start" />
                          {t('approvals.approve')}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === a.id} onClick={() => decide(a, 'reject')}>
                          <X data-icon="inline-start" />
                          {t('approvals.reject')}
                        </Button>
                      </ItemActions>
                    )}
                  </Item>
                ))}
              </SettingsList>
            )}
          </SettingsCard>
        </TabsContent>

        <TabsContent value="policy" className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('approvals.policyHint')}</p>
          <CustomPolicyEditor
            value={custom}
            onChange={setCustom}
            disabled={!editable || saving || !loaded}
            footer={editable && (
              <SaveButton dirty={dirty} saving={saving} disabled={!loaded || invalid} onClick={save} />
            )}
            footerHint={!loaded && (loadFailed
              ? <span className="text-destructive">{t('admin.loadFailed')}</span>
              : t('admin.loading'))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
