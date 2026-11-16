'use client';
import { threadPath } from '@/lib/thread-link';
import { Card } from '@/components/ui/card';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Lock, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { CustomPolicyEditor, type CustomPolicy } from '@/components/settings/custom-policy-editor';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import { canActOnApproval } from '@/lib/approvals';
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

  const save = async () => {
    if (!editable || !loaded || custom.some((r) => (!r.description.trim() || (r.policy === 'member' && !r.approver_email)))) return;
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 border-b pb-4">
        <h2 className="font-heading text-lg font-medium">{t('admin.approvalsTitle')}</h2>
        <Alert role="note">
          <AlertTriangle aria-hidden="true" className="text-warning" />
          <AlertTitle>{t('approvals.advisoryWarning')}</AlertTitle>
          <AlertDescription>{t('admin.approvalsDescription')}</AlertDescription>
        </Alert>
      </div>
      {!editable && <ReadOnlyBanner />}

      <Tabs defaultValue="policy">
        <TabsList variant="line">
          <TabsTrigger value="policy">{t('approvals.policyTitle')}</TabsTrigger>
          <TabsTrigger value="pending">{t('approvals.pendingTab')}{!!pending?.length && <span className="rounded-full bg-muted px-1.5 text-xs">{pending.length}</span>}</TabsTrigger>
        </TabsList>
      <TabsContent value="pending" className="flex flex-col gap-3 pt-4">
        <h2 className="text-sm font-semibold">
          {t('approvals.pendingTitle')}
          {pending && pending.length > 0 && (
            <span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
              {pending.length}
            </span>
          )}
        </h2>
        <Card className="gap-0 divide-y py-0">
          {pending === null ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('admin.loading')}</p>
          ) : pending.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('approvals.nonePending')}</p>
          ) : pending.map((a) => {
            const allowed = canActOnApproval(me, a, workspace.requireLogin);
            return (
              <div key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Lock className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{a.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.requestedBy} · {t(KIND_KEYS[a.kind] ?? 'approvals.kinds.generic')} · {t('approvals.needs', { role: a.policyRequirements?.members.length ? a.policyRequirements.members.join(', ') + (a.policyRequirements.role_required ? ` + ${roleText(a.policyRequirements.role_required)}` : '') : roleText(a.requiredRole) })}
                      {a.createdAt && <> · {timeAgoShort(a.createdAt)}</>}
                    </span>
                  </div>
                  {a.details && (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 font-mono text-xs">
                      {a.details}
                    </pre>
                  )}
                  {!!a.policyRequirements?.approved_by.length && <p className="mt-1 text-xs text-muted-foreground">{t('approvals.reviewedBy', { people: a.policyRequirements.approved_by.join(', ') })}</p>}
                  {a.note && <p className="mt-1 text-xs text-muted-foreground">{a.note}</p>}
                  <Button
                    type="button"
                    onClick={async () => {
                      try {
                        const link = await workspaceApi.getThreadLink(a.channelName);
                        window.location.assign(`${threadPath(workspaceId, link.id)}${query}`);
                      } catch { toast.error(t('share.threadUnavailable')); }
                    }}
                    variant="link" size="xs" className="mt-1 h-auto self-start px-0 text-muted-foreground"
                  >
                    {t('approvals.openThread')} <ExternalLink className="size-3" />
                  </Button>
                </div>
                {allowed && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" className="h-8 gap-1" disabled={busyId === a.id} onClick={() => decide(a, 'approve')}>
                      <Check className="size-3.5" /> {t('approvals.approve')}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busyId === a.id} onClick={() => decide(a, 'reject')}>
                      <X className="size-3.5" /> {t('approvals.reject')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      </TabsContent>

      <TabsContent value="policy" className="flex flex-col gap-3 pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('approvals.policyTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('approvals.policyHint')}</p>
          </div>
          {editable && (
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-8" disabled={!dirty || saving || !loaded || custom.some((r) => (!r.description.trim() || (r.policy === 'member' && !r.approver_email)))} onClick={save}>
                {t('common.save')}
              </Button>
            </div>
          )}
        </div>
        <CustomPolicyEditor value={custom} onChange={setCustom} disabled={!editable || saving || !loaded} />
        {!loaded && <p className="text-sm text-muted-foreground">{t(loadFailed ? 'admin.loadFailed' : 'admin.loading')}</p>}
      </TabsContent>
      </Tabs>
    </div>
  );
}
