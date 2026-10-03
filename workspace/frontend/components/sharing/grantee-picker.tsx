'use client';

/**
 * TEMPORARY STUB — permission model v1.1, frontend part D.
 *
 * Part C ships the real `GranteePicker` at this exact path with these exact
 * props (spec §5). This minimal version exists only so part D's share
 * surfaces compile and work in isolation: a text box that suggests people
 * (team), agents (workspace context) and groups (/groups), plus chips for the
 * picked grantees. At merge: part C's file replaces this one wholesale.
 */

import { useEffect, useMemo, useState } from 'react';
import { Bot, Users, User, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { accessApi, type Grantee, type GranteeKind } from '@/lib/access-stubs';
import { cn } from '@/lib/utils';

export type { Grantee, GranteeKind };

export interface GranteePickerProps {
  value: Grantee[];
  onChange(v: Grantee[]): void;
  kinds?: GranteeKind[];
  exclude?: string[];
}

const ALL_KINDS: GranteeKind[] = ['human', 'agent', 'group'];

function KindIcon({ kind, className }: { kind: GranteeKind; className?: string }) {
  const Icon = kind === 'agent' ? Bot : kind === 'group' ? Users : User;
  return <Icon className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />;
}

export function GranteePicker({ value, onChange, kinds = ALL_KINDS, exclude = [] }: GranteePickerProps) {
  const { agents } = useWorkspace();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Grantee[]>([]);
  const [groups, setGroups] = useState<Grantee[]>([]);

  useEffect(() => {
    if (kinds.includes('human')) {
      workspaceApi.getTeam()
        .then((team) => setPeople(team.map((m) => ({ kind: 'human', id: m.email, label: m.displayName || m.email }))))
        .catch(() => setPeople([]));
    }
    if (kinds.includes('group')) {
      accessApi.listGroups()
        .then((gs) => setGroups(gs.map((g) => ({ kind: 'group', id: g.id, label: g.name }))))
        .catch(() => setGroups([]));
    }
    // kinds is a prop array; callers pass literals, so compare by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds.join(',')]);

  const candidates = useMemo<Grantee[]>(() => {
    const agentOptions: Grantee[] = kinds.includes('agent')
      ? agents.map((a) => ({ kind: 'agent', id: a.agentName, label: a.displayName || a.agentName }))
      : [];
    const all = [...(kinds.includes('group') ? groups : []), ...(kinds.includes('human') ? people : []), ...agentOptions];
    const taken = new Set([...exclude, ...value.map((v) => `${v.kind}:${v.id}`), ...value.map((v) => v.id)]);
    const q = query.trim().toLowerCase();
    return all
      .filter((g) => !taken.has(g.id) && !taken.has(`${g.kind}:${g.id}`))
      .filter((g) => !q || g.label.toLowerCase().includes(q) || g.id.toLowerCase().includes(q))
      .slice(0, 8);
  }, [agents, groups, people, kinds, exclude, value, query]);

  const add = (g: Grantee) => {
    onChange([...value, g]);
    setQuery('');
  };

  const addTypedEmail = () => {
    const q = query.trim().toLowerCase();
    if (!kinds.includes('human') || !q.includes('@')) return;
    add({ kind: 'human', id: q, label: q });
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((g) => (
            <span
              key={`${g.kind}:${g.id}`}
              className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs"
            >
              <KindIcon kind={g.kind} />
              <span className="max-w-40 truncate">{g.label}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => !(v.kind === g.kind && v.id === g.id)))}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${g.label}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (candidates[0]) add(candidates[0]);
          else addTypedEmail();
        }}
        placeholder="Search people, agents, groups…"
        className="h-8 text-sm"
      />
      {(query || candidates.length > 0) && (
        <ul className="max-h-44 overflow-y-auto rounded-md border text-sm">
          {candidates.map((g) => (
            <li key={`${g.kind}:${g.id}`}>
              <button
                type="button"
                onClick={() => add(g)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted"
              >
                <KindIcon kind={g.kind} />
                <span className="truncate">{g.label}</span>
                {g.label !== g.id && <span className="ml-auto truncate text-xs text-muted-foreground">{g.id}</span>}
              </button>
            </li>
          ))}
          {candidates.length === 0 && query.includes('@') && kinds.includes('human') && (
            <li>
              <button
                type="button"
                onClick={addTypedEmail}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted"
              >
                <KindIcon kind="human" />
                <span className="truncate">{query.trim().toLowerCase()}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
