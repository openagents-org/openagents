'use client';

/**
 * Permission model v1.1 — "Who can use this agent".
 *
 * Replaces the personal/team toggle and the email-only grants list: what an
 * agent can be used for is exactly its `act` grants. The section is an
 * "Everyone in the workspace" switch (= a grant to the builtin `everyone`
 * group), the list of other grantees (groups, people, agents) with optional
 * expiry, and a picker to add more.
 *
 * `AgentUsabilityLine` is the read-only one-liner for the profile panel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, User, Users, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { GranteePicker } from '@/components/sharing/grantee-picker';
import type { Grantee, GranteeKind, ResourceGrant, SecurityGroup } from '@/lib/types';
import { workspaceApi } from '@/lib/api';
import {
  EXPIRY_PRESETS,
  expiryPresetToIso,
  findEveryoneGroup,
  legacyUsableBy,
  usabilitySummary,
  type ExpiryPreset,
} from '@/lib/artifact-access';
import { useFormatters, useT } from '@/lib/i18n';
import type { AgentUsableBy } from '@/lib/types';
import { cn } from '@/lib/utils';

function GranteeIcon({ kind }: { kind: GranteeKind }) {
  const Icon = kind === 'agent' ? Bot : kind === 'group' ? Users : User;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

export function AgentAccessSection({
  agentName, displayName, canManage = true, onChanged, resourceKind = 'agent',
}: {
  agentName: string;
  resourceKind?: 'agent' | 'service';
  displayName?: string;
  canManage?: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const name = displayName || agentName;

  const [groups, setGroups] = useState<SecurityGroup[] | null>(null);
  const [grants, setGrants] = useState<ResourceGrant[] | null>(null);
  const everyoneGroup = useMemo(() => (groups ? findEveryoneGroup(groups) : undefined), [groups]);

  const load = useCallback(async () => {
    try {
      const [gs, gr] = await Promise.all([
        workspaceApi.listGroups().catch(() => [] as SecurityGroup[]),
        workspaceApi.listGrants(resourceKind, agentName),
      ]);
      setGroups(gs);
      setGrants(gr);
    } catch {
      setGroups((prev) => prev ?? []);
      setGrants([]);
      toast.error(t('agentAccess.loadFailed'));
    }
  }, [agentName, resourceKind, t]);
  useEffect(() => { load(); }, [load]);

  const everyoneGrant = useMemo(
    () => (everyoneGroup ? grants?.find((g) => g.grantee_kind === 'group' && g.grantee_id === everyoneGroup.id) : undefined),
    [grants, everyoneGroup],
  );
  const others = useMemo(
    () => (grants ?? []).filter((g) => g.id !== everyoneGrant?.id),
    [grants, everyoneGrant],
  );

  // ── everyone switch ──
  const [togglingEveryone, setTogglingEveryone] = useState(false);
  const setEveryone = async (on: boolean) => {
    if (!everyoneGroup || togglingEveryone) return;
    setTogglingEveryone(true);
    try {
      if (on) {
        await workspaceApi.createGrant({
          resource_kind: resourceKind,
          resource_id: agentName,
          grantee_kind: 'group',
          grantee_id: everyoneGroup.id,
          rights: ['act'],
        });
        toast.success(t('agentAccess.everyoneOn', { agent: name }));
      } else if (everyoneGrant) {
        await workspaceApi.revokeGrant(everyoneGrant.id);
        toast.success(t('agentAccess.everyoneOff', { agent: name }));
      }
      await load();
      onChanged?.();
    } catch {
      toast.error(t('agentAccess.everyoneFailed'));
    } finally {
      setTogglingEveryone(false);
    }
  };

  // ── add grants ──
  const [picked, setPicked] = useState<Grantee[]>([]);
  const [expiry, setExpiry] = useState<ExpiryPreset>('never');
  const [granting, setGranting] = useState(false);
  const exclude = useMemo(() => (grants ?? []).map((g) => g.grantee_id), [grants]);

  const grant = async () => {
    if (picked.length === 0 || granting) return;
    setGranting(true);
    const expires_at = expiryPresetToIso(expiry);
    let done = 0;
    for (const g of picked) {
      try {
        await workspaceApi.createGrant({
          resource_kind: resourceKind,
          resource_id: agentName,
          grantee_kind: g.kind,
          grantee_id: g.id,
          rights: ['act'],
          ...(expires_at ? { expires_at } : {}),
        });
        done += 1;
        toast.success(t('agentAccess.granted', { grantee: g.label, agent: name }));
      } catch {
        toast.error(t('agentAccess.grantFailed', { grantee: g.label }));
      }
    }
    setGranting(false);
    if (done > 0) {
      setPicked([]);
      await load();
      onChanged?.();
    }
  };

  const revoke = async (g: ResourceGrant) => {
    setGrants((prev) => prev?.filter((x) => x.id !== g.id) ?? prev);
    try {
      await workspaceApi.revokeGrant(g.id);
      toast.success(t('agentAccess.revoked'));
      onChanged?.();
    } catch {
      toast.error(t('agentAccess.revokeFailed'));
      load();
    }
  };

  const expiryLabel = (p: ExpiryPreset) =>
    p === '7d' ? t('agentAccess.expiry7d')
    : p === '30d' ? t('agentAccess.expiry30d')
    : p === '90d' ? t('agentAccess.expiry90d')
    : t('agentAccess.expiryNever');

  return (
    <section className="flex flex-col gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(resourceKind === 'service' ? 'services.audience' : 'agentAccess.title')}</h4>

      {grants === null ? (
        <Spinner className="text-muted-foreground" />
      ) : (
        <>
          {/* Everyone switch */}
          <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
            <Field className="min-w-0">
              <FieldLabel>{t('agentAccess.everyoneSwitch')}</FieldLabel>
              <FieldDescription>
                {everyoneGroup ? t('agentAccess.everyoneHint') : t('agentAccess.everyoneGroupMissing')}
              </FieldDescription>
            </Field>
            <Switch
              checked={!!everyoneGrant}
              onCheckedChange={setEveryone}
              disabled={!canManage || !everyoneGroup || togglingEveryone}
              aria-label={t('agentAccess.everyoneSwitch')}
            />
          </div>

          {/* Other grantees */}
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('agentAccess.grantsEmpty')}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {others.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-3 py-2">
                  <GranteeIcon kind={g.grantee_kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{g.grantee_label || g.grantee_id}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {g.grantee_kind === 'group' ? t('artifactAccess.granteeKindGroup')
                        : g.grantee_kind === 'agent' ? t('artifactAccess.granteeKindAgent')
                        : g.grantee_id}
                      {g.expires_at ? ` · ${t('agentAccess.expiresOn', { date: formatDate(g.expires_at) })}` : ''}
                      {g.note ? ` · ${g.note}` : ''}
                    </p>
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => revoke(g)} title={t('agentAccess.revoke')}>
                      <X className="size-3.5" />
                      <span className="hidden sm:inline">{t('agentAccess.revoke')}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Add */}
          {canManage && (
            <Field>
              <FieldLabel>{t('agentAccess.addTitle')}</FieldLabel>
              <GranteePicker value={picked} onChange={setPicked} exclude={exclude} />
              <div className="flex items-center gap-2">
                <Select value={expiry} onValueChange={(v) => setExpiry(v as ExpiryPreset)}>
                  <SelectTrigger className="h-8 w-40 text-xs" aria-label={t('agentAccess.expiry')}>
                    <span className="text-muted-foreground">{t('agentAccess.expiry')}:</span>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>{EXPIRY_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>{expiryLabel(p)}</SelectItem>
                    ))}</SelectGroup>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={grant} disabled={granting || picked.length === 0} className="ml-auto">
                  {granting ? <Spinner className="size-3.5" /> : <Plus className="size-3.5" />}
                  {granting ? t('agentAccess.granting') : t('agentAccess.grant')}
                </Button>
              </div>
            </Field>
          )}
        </>
      )}
    </section>
  );
}

/** Read-only "Usable by: Everyone / 3 groups · 2 people / Only owner" for the
 * profile panel. Looks the agent up in the directory lazily; renders nothing
 * until it knows (and nothing at all on failure or for unknown agents). */
export function AgentUsabilityLine({ agentName, className }: { agentName: string; className?: string }) {
  const t = useT();
  const [usableBy, setUsableBy] = useState<AgentUsableBy | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setUsableBy(undefined);
    workspaceApi.getAgentDirectory()
      .then((entries) => {
        if (cancelled) return;
        const entry = entries.find((e) => e.agent_name === agentName);
        if (!entry) { setUsableBy(null); return; }
        setUsableBy(entry.usable_by ?? legacyUsableBy(entry.visibility, entry.grant_count));
      })
      .catch(() => { if (!cancelled) setUsableBy(null); });
    return () => { cancelled = true; };
  }, [agentName]);

  if (!usableBy) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded bg-muted px-1.5 py-px text-xs font-medium text-muted-foreground', className)}
      title={t('agentAccess.title')}
    >
      <Users className="size-3" />
      {t('agentAccess.usableBy')}: {usabilitySummary(t, usableBy)}
    </span>
  );
}
