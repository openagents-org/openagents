'use client';

// ── v1.1 permission model — grantee picker ───────────────────────────────────
// One combobox for "who": people (collaborators), agents and security groups,
// with kind chips to narrow the list and removable chips for the selection.
// Used by the share dialog, the new-thread dialog, the Groups tab and (part D)
// the files / knowledge / agent share menus — keep the exported props stable.
//
// Data is fetched here rather than read from WorkspaceProvider: the settings
// pages have no provider, and the main context does not expose collaborators.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { displayNameFromEmail } from '@/lib/collab';
import {
  granteeKey,
  isExcludedGrantee,
  mergeGrantees,
  removeGrantee,
} from '@/lib/access-ui';
import type { Grantee, GranteeKind, SecurityGroup, TeamMember } from '@/lib/types';
import { CandidateAvatar, GranteeChip, KindIcon } from './grantee-chip';

export { GranteeChip, KindIcon };

export interface GranteePickerProps {
  value: Grantee[];
  onChange: (v: Grantee[]) => void;
  /** Which kinds are offered (default: all three). */
  kinds?: GranteeKind[];
  /** Ids (or `kind:id` keys) to hide — already granted, the viewer, … */
  exclude?: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface Candidate extends Grantee {
  /** Second line in the list: email, agent name, member count. */
  hint: string;
}

const ALL_KINDS: GranteeKind[] = ['human', 'agent', 'group'];

// A short-lived module cache so opening the picker twice in a row (share
// dialog → new-thread dialog) does not refetch three endpoints each time.
const CACHE_TTL_MS = 30_000;
let cache: { at: number; people: TeamMember[]; agents: { name: string; label: string }[]; groups: SecurityGroup[] } | null = null;

async function loadCandidates(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const [people, discovery, groups] = await Promise.all([
    workspaceApi.getTeam().catch(() => [] as TeamMember[]),
    workspaceApi.discover().catch(() => null),
    workspaceApi.listGroups().catch(() => [] as SecurityGroup[]),
  ]);
  const agents = (discovery?.agents || []).map((a) => ({
    name: a.address.replace(/^openagents:/, ''),
    label: a.display_name?.trim() || a.address.replace(/^openagents:/, ''),
  }));
  cache = { at: Date.now(), people, agents, groups };
  return cache;
}

/** Drop the cache (after creating a group, for instance). */
export function invalidateGranteeCandidates() {
  cache = null;
}

export function GranteePicker({
  value,
  onChange,
  kinds = ALL_KINDS,
  exclude,
  placeholder,
  disabled,
  className,
}: GranteePickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof loadCandidates>> | null>(null);
  const [kindFilter, setKindFilter] = useState<GranteeKind | null>(null);

  const offered = useMemo(() => ALL_KINDS.filter((k) => kinds.includes(k)), [kinds]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setData(await loadCandidates());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !data && !loading) load();
  }, [open, data, loading, load]);

  const candidates = useMemo<Record<GranteeKind, Candidate[]>>(() => {
    const out: Record<GranteeKind, Candidate[]> = { human: [], agent: [], group: [] };
    if (!data) return out;
    if (offered.includes('human')) {
      out.human = data.people.map((m) => ({
        kind: 'human' as const,
        id: m.email.toLowerCase(),
        label: m.displayName?.trim() || displayNameFromEmail(m.email),
        hint: m.email,
      }));
    }
    if (offered.includes('agent')) {
      out.agent = data.agents.map((a) => ({ kind: 'agent' as const, id: a.name, label: a.label, hint: a.name }));
    }
    if (offered.includes('group')) {
      out.group = data.groups.map((g) => ({
        kind: 'group' as const,
        id: g.id,
        label: g.name,
        hint: t('groups.memberCount', { count: g.member_count }),
      }));
    }
    for (const k of ALL_KINDS) out[k] = out[k].filter((c) => !isExcludedGrantee(c, exclude));
    return out;
  }, [data, offered, exclude, t]);

  const selectedKeys = useMemo(() => new Set(value.map(granteeKey)), [value]);

  const toggle = (c: Candidate) => {
    const g: Grantee = { kind: c.kind, id: c.id, label: c.label };
    onChange(selectedKeys.has(granteeKey(g)) ? removeGrantee(value, g) : mergeGrantees(value, [g]));
  };

  const visibleKinds = kindFilter ? offered.filter((k) => k === kindFilter) : offered;
  const kindLabel = (k: GranteeKind) =>
    k === 'human' ? t('groups.kindPeople') : k === 'agent' ? t('groups.kindAgents') : t('groups.kindGroups');

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-start font-normal text-muted-foreground"
          >
            <Plus className="size-4" />
            {placeholder || t('groups.pickerPlaceholder')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-70 w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
          <Command loop>
            <CommandInput placeholder={t('groups.pickerSearch')} />
            {offered.length > 1 && (
              <ToggleGroup type="single" size="sm" variant="outline" spacing={1} value={kindFilter ?? ''}
                onValueChange={(next) => setKindFilter((next || null) as GranteeKind | null)}
                className="w-full flex-wrap border-b px-2 py-1.5">
                {offered.map((k) => (
                  <ToggleGroupItem key={k} value={k} className="text-xs">
                    <KindIcon kind={k} />
                    {kindLabel(k)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
            <CommandList className="max-h-72 overscroll-contain">
              {loading && (
                <div className="flex items-center justify-center py-6">
                  <Spinner className="text-muted-foreground" />
                </div>
              )}
              {!loading && failed && (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {t('groups.pickerLoadFailed')}
                  <Button variant="ghost" size="sm" className="ml-1 h-auto px-1 py-0" onClick={() => load()}>
                    {t('common.retry')}
                  </Button>
                </div>
              )}
              {!loading && !failed && <CommandEmpty>{t('groups.pickerNoResults')}</CommandEmpty>}
              {!loading && !failed && visibleKinds.map((k) => (
                candidates[k].length > 0 && (
                  <CommandGroup key={k} heading={kindLabel(k)}>
                    {candidates[k].map((c) => {
                      const selected = selectedKeys.has(granteeKey(c));
                      return (
                        <CommandItem
                          key={granteeKey(c)}
                          value={granteeKey(c)}
                          keywords={[c.label, c.id, c.hint]}
                          onSelect={() => toggle(c)}
                          className="py-1.5 text-sm"
                        >
                          <CandidateAvatar c={c} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{c.label}</span>
                            {c.hint !== c.label && (
                              <span className="block truncate text-xs text-muted-foreground">{c.hint}</span>
                            )}
                          </span>
                          <Check className={cn('size-4', selected ? 'opacity-100' : 'opacity-0')} />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((g) => (
            <GranteeChip
              key={granteeKey(g)}
              grantee={g}
              onRemove={disabled ? undefined : () => onChange(removeGrantee(value, g))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────
