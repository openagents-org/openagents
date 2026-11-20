'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel, FieldSeparator, FieldSet, FieldTitle } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { IconAction } from '@/components/settings/icon-action';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty } from '@/components/settings/settings-list';
import { workspaceApi } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';
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

const VERDICTS: { value: ApprovalPolicyVerdict; label: MessageKey }[] = [
  { value: 'allow', label: 'approvals.verdictAllow' },
  { value: 'any', label: 'approvals.verdictAny' },
  { value: 'admin', label: 'approvals.verdictAdmin' },
  { value: 'owner', label: 'approvals.verdictOwner' },
  { value: 'member', label: 'approvals.verdictMember' },
  { value: 'block', label: 'approvals.verdictBlock' },
];

/** One policy: its condition, what it requires, and (for "member") who. */
function PolicyRule({ rule, index, members, membersFailed, disabled, onUpdate, onRemove }: {
  rule: CustomPolicy;
  index: number;
  members: TeamMember[];
  membersFailed: boolean;
  disabled: boolean;
  onUpdate: (patch: Partial<CustomPolicy>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const strayApprover = rule.approver_email && !members.some((m) => m.email === rule.approver_email);
  return (
    <FieldSet>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={rule.kind}>{t('approvals.condition')} {index + 1}</FieldLabel>
          <IconAction label={t('approvals.removePolicy', { number: index + 1 })} disabled={disabled} onClick={onRemove}>
            <Trash2 />
          </IconAction>
        </div>
        <Textarea id={rule.kind} value={rule.description} maxLength={1000} rows={2} disabled={disabled}
          placeholder={t('approvals.conditionPlaceholder')}
          onChange={(event) => onUpdate({ description: event.target.value })} />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor={`${rule.kind}-policy`} className="font-normal text-muted-foreground">{t('approvals.requirement')}</FieldLabel>
        <Select name={`${rule.kind}-policy`} value={rule.policy} disabled={disabled}
          onValueChange={(v) => onUpdate({ policy: v as CustomPolicy['policy'], approver_email: undefined })}>
          <SelectTrigger id={`${rule.kind}-policy`} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {VERDICTS.map((v) => <SelectItem key={v.value} value={v.value}>{t(v.label)}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {rule.policy === 'member' && (
        <Field>
          <FieldLabel htmlFor={`${rule.kind}-member`} className="font-normal text-muted-foreground">{t('approvals.chooseMember')}</FieldLabel>
          <Select name={`${rule.kind}-member`} value={rule.approver_email || ''} disabled={disabled || membersFailed}
            onValueChange={(v) => onUpdate({ approver_email: v })}>
            <SelectTrigger id={`${rule.kind}-member`} className="w-full">
              <SelectValue placeholder={t('approvals.chooseMember')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {strayApprover && <SelectItem value={rule.approver_email!}>{rule.approver_email}</SelectItem>}
                {members.map((m) => (
                  <SelectItem key={m.email} value={m.email}>{m.displayName ? `${m.displayName} · ${m.email}` : m.email}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {membersFailed && <FieldError>{t('admin.loadFailed')}</FieldError>}
          <FieldDescription>{t('approvals.specificMemberHint')}</FieldDescription>
        </Field>
      )}
    </FieldSet>
  );
}

/** The workspace's own approval policies, edited as a list of conditions. */
export function CustomPolicyEditor({ value, onChange, disabled, footer, footerHint }: {
  value: CustomPolicy[];
  onChange: (value: CustomPolicy[]) => void;
  disabled: boolean;
  /** The card's footer actions (the page's Save). */
  footer?: ReactNode;
  /** Muted status on the left of the footer (loading, load failure). */
  footerHint?: ReactNode;
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
  const full = value.length >= 20;

  return (
    <SettingsCard
      title={t('approvals.customTitle')}
      description={t('approvals.customHint')}
      action={(
        <Button size="sm" variant="outline" disabled={disabled || full} onClick={() => add()}>
          <Plus data-icon="inline-start" />{t('approvals.addPolicy')}
        </Button>
      )}
      footer={footer}
      footerHint={footerHint}
    >
      <Field>
        <FieldTitle className="font-normal text-muted-foreground">{t('approvals.templates')}</FieldTitle>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(({ key, policy }) => (
            <Button key={key} size="sm" variant="secondary" disabled={disabled || full}
              onClick={() => add(t(`approvals.template.${key}.description`), policy)}>
              {t(`approvals.template.${key}.title`)}
            </Button>
          ))}
        </div>
      </Field>
      <FieldSeparator />
      {value.length === 0 ? (
        <ListEmpty>{t('approvals.noCustomPolicies')}</ListEmpty>
      ) : (
        <div className="flex max-h-110 flex-col gap-5 overflow-y-auto">
          {value.map((rule, index) => (
            <Fragment key={rule.kind}>
              {index > 0 && <FieldSeparator />}
              <PolicyRule
                rule={rule}
                index={index}
                members={members}
                membersFailed={membersFailed}
                disabled={disabled}
                onUpdate={(patch) => update(rule.kind, patch)}
                onRemove={() => onChange(value.filter((r) => r.kind !== rule.kind))}
              />
            </Fragment>
          ))}
        </div>
      )}
      <FieldDescription>{t('approvals.customEvaluation')}</FieldDescription>
    </SettingsCard>
  );
}
