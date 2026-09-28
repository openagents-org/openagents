'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, Lock, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import { canDecideApproval } from '@/lib/approvals';
import { useFormatters, useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/translate';
import type { ApprovalPolicyRule, ApprovalPolicyVerdict, ApprovalRequest } from '@/lib/types';

const VERDICTS: ApprovalPolicyVerdict[] = ['allow', 'any', 'admin', 'owner', 'block'];
const VERDICT_KEYS: Record<ApprovalPolicyVerdict, MessageKey> = {
  allow: 'approvals.verdictAllow',
  any: 'approvals.verdictAny',
  admin: 'approvals.verdictAdmin',
  owner: 'approvals.verdictOwner',
  block: 'approvals.verdictBlock',
};
const KIND_KEYS: Record<string, MessageKey> = {
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
 * Two parts. The queue at the top is everything currently waiting on a human
 * (approve/reject here or in the thread — same endpoint). Below it, the
 * workspace-default permission policy: one verdict per action kind. Channel
 * overrides exist in the API and are surfaced per thread later.
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
      await workspaceApi.resolveApproval(a.id, decision);
      setPending((prev) => (prev || []).filter((x) => x.id !== a.id));
    } catch {
      toast.error(t('approvals.failed'));
    } finally {
      setBusyId(null);
    }
  };

  // ── Policy ──
  const [rules, setRules] = useState<ApprovalPolicyRule[] | null>(null);
  const [draft, setDraft] = useState<Record<string, ApprovalPolicyVerdict>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    workspaceApi.getApprovalPolicy()
      .then((p) => {
        setRules(p.rules);
        setDraft(Object.fromEntries(p.rules.map((r) => [r.kind, r.policy])));
      })
      .catch(() => setRules([]));
  }, []);

  const dirty = useMemo(
    () => (rules || []).some((r) => draft[r.kind] && draft[r.kind] !== r.policy),
    [rules, draft],
  );

  const save = async () => {
    setSaving(true);
    try {
      const p = await workspaceApi.updateApprovalPolicy(
        Object.entries(draft).map(([kind, policy]) => ({ kind, policy })),
      );
      setRules(p.rules);
      setDraft(Object.fromEntries(p.rules.map((r) => [r.kind, r.policy])));
      toast.success(t('approvals.saved'));
    } catch {
      toast.error(t('approvals.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    setSaving(true);
    try {
      const p = await workspaceApi.updateApprovalPolicy([]);
      setRules(p.rules);
      setDraft(Object.fromEntries(p.rules.map((r) => [r.kind, r.policy])));
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
    <div className="space-y-8">
      <SectionHeader title={t('admin.approvalsTitle')} description={t('admin.approvalsDescription')} />
      {!editable && <ReadOnlyBanner />}

      {/* Pending queue */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          {t('approvals.pendingTitle')}
          {pending && pending.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              {pending.length}
            </span>
          )}
        </h2>
        <div className="divide-y rounded-lg border">
          {pending === null ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('admin.loading')}</p>
          ) : pending.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('approvals.nonePending')}</p>
          ) : pending.map((a) => {
            const allowed = canDecideApproval(me, a.requiredRole, workspace.requireLogin);
            return (
              <div key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{a.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.requestedBy} · {t(KIND_KEYS[a.kind] ?? 'approvals.kinds.generic')} · {t('approvals.needs', { role: roleText(a.requiredRole) })}
                      {a.createdAt && <> · {timeAgoShort(a.createdAt)}</>}
                    </span>
                  </div>
                  {a.details && (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 font-mono text-[11px]">
                      {a.details}
                    </pre>
                  )}
                  <Link
                    href={`/${workspaceId}${query}#?thread=${encodeURIComponent(a.channelName)}`}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('approvals.openThread')} <ExternalLink className="size-3" />
                  </Link>
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
        </div>
      </section>

      {/* Permission policy */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('approvals.policyTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('approvals.policyHint')}</p>
          </div>
          {editable && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" disabled={saving} onClick={resetDefaults}>
                <RotateCcw className="size-3.5" /> {t('approvals.reset')}
              </Button>
              <Button size="sm" className="h-8" disabled={!dirty || saving} onClick={save}>
                {t('common.save')}
              </Button>
            </div>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t('approvals.colAction')}</th>
                <th className="px-4 py-2 font-medium">{t('approvals.colPolicy')}</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('approvals.colSource')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(rules || []).map((r) => (
                <tr key={r.kind}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{t(KIND_KEYS[r.kind] ?? 'approvals.kinds.generic')}</div>
                    <div className="text-xs text-muted-foreground">{r.label}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      value={draft[r.kind] ?? r.policy}
                      onValueChange={(v) => setDraft((d) => ({ ...d, [r.kind]: v as ApprovalPolicyVerdict }))}
                      disabled={!editable}
                    >
                      <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {VERDICTS.map((v) => (
                          <SelectItem key={v} value={v}>{t(VERDICT_KEYS[v])}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="hidden px-4 py-2.5 text-xs text-muted-foreground sm:table-cell">
                    {r.source === 'default' ? t('approvals.sourceDefault') : r.source === 'workspace' ? t('approvals.sourceWorkspace') : t('approvals.sourceChannel')}
                  </td>
                </tr>
              ))}
              {rules !== null && rules.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-3 text-sm text-muted-foreground">{t('admin.loadFailed')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
