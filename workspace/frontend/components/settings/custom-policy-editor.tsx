'use client';

import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import type { ApprovalPolicyVerdict, TeamMember } from '@/lib/types';

export interface CustomPolicy {
  kind: string;
  description: string;
  policy: ApprovalPolicyVerdict;
  approver_email?: string;
}

const TEMPLATES = [
  { key: 'production', policy: 'admin' },
  { key: 'spending', policy: 'owner' },
  { key: 'customers', policy: 'admin' },
  { key: 'sensitive', policy: 'block' },
] as const;

export function CustomPolicyEditor({ value, onChange, disabled }: {
  value: CustomPolicy[];
  onChange: (value: CustomPolicy[]) => void;
  disabled: boolean;
}) {
  const t = useT();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersFailed, setMembersFailed] = useState(false);
  useEffect(() => {
    workspaceApi.getTeam().then((people) => setMembers(people.filter((p) => p.role !== 'viewer')))
      .catch(() => setMembersFailed(true));
  }, []);
  const add = (description = '', policy: CustomPolicy['policy'] = 'admin') => {
    onChange([...value, { kind: `custom:${crypto.randomUUID()}`, description, policy }]);
  };
  const update = (kind: string, patch: Partial<CustomPolicy>) =>
    onChange(value.map((rule) => rule.kind === kind ? { ...rule, ...patch } : rule));

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('approvals.customTitle')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('approvals.customHint')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={disabled || value.length >= 20} onClick={() => add()}>
          <Plus className="mr-1 size-3.5" />{t('approvals.addPolicy')}
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('approvals.templates')}</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(({ key, policy }) => (
            <Button key={key} size="sm" variant="secondary" disabled={disabled || value.length >= 20}
              onClick={() => add(t(`approvals.template.${key}.description`), policy)}>
              {t(`approvals.template.${key}.title`)}
            </Button>
          ))}
        </div>
      </div>
      {value.length === 0 && <p className="text-sm text-muted-foreground">{t('approvals.noCustomPolicies')}</p>}
      <div className="max-h-[440px] space-y-3 overflow-y-auto">
        {value.map((rule, index) => (
          <div key={rule.kind} className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={rule.kind} className="text-xs font-medium">{t('approvals.condition')} {index + 1}</label>
              <Button size="icon" variant="ghost" className="size-7" disabled={disabled}
                aria-label={t('approvals.removePolicy', { number: index + 1 })}
                onClick={() => onChange(value.filter((r) => r.kind !== rule.kind))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <textarea id={rule.kind} value={rule.description} maxLength={1000} rows={2} disabled={disabled}
              placeholder={t('approvals.conditionPlaceholder')}
              onChange={(event) => update(rule.kind, { description: event.target.value })}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50" />
            <div className="flex items-center gap-3">
              <label htmlFor={`${rule.kind}-policy`} className="text-xs text-muted-foreground">{t('approvals.requirement')}</label>
              <select id={`${rule.kind}-policy`} value={rule.policy} disabled={disabled}
                onChange={(event) => update(rule.kind, { policy: event.target.value as CustomPolicy['policy'], approver_email: undefined })}
                className="h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50">
                <option value="allow">{t('approvals.verdictAllow')}</option>
                <option value="any">{t('approvals.verdictAny')}</option>
                <option value="admin">{t('approvals.verdictAdmin')}</option>
                <option value="owner">{t('approvals.verdictOwner')}</option>
                <option value="member">{t('approvals.verdictMember')}</option>
                <option value="block">{t('approvals.verdictBlock')}</option>
              </select>
            </div>
            {rule.policy === 'member' && (
              <div className="space-y-1">
                <label htmlFor={`${rule.kind}-member`} className="text-xs text-muted-foreground">{t('approvals.chooseMember')}</label>
                <select id={`${rule.kind}-member`} value={rule.approver_email || ''} disabled={disabled || membersFailed}
                  onChange={(event) => update(rule.kind, { approver_email: event.target.value })}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50">
                  <option value="">{t('approvals.chooseMember')}</option>
                  {rule.approver_email && !members.some((m) => m.email === rule.approver_email) && (
                    <option value={rule.approver_email}>{rule.approver_email}</option>
                  )}
                  {members.map((m) => <option key={m.email} value={m.email}>{m.displayName ? `${m.displayName} · ${m.email}` : m.email}</option>)}
                </select>
                {membersFailed && <p className="text-xs text-destructive">{t('admin.loadFailed')}</p>}
                <p className="text-xs text-muted-foreground">{t('approvals.specificMemberHint')}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('approvals.customEvaluation')}</p>
    </div>
  );
}
