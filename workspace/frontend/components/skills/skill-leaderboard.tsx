'use client';

import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { RegistryLeaderboardEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { Skill } from './skill-types';
import { registrySkillToSkill } from './skill-utils';

const LEADERBOARD_BOARDS = ['community', 'official'] as const;
const LEADERBOARD_WINDOWS = [7, 30] as const;

type Board = (typeof LEADERBOARD_BOARDS)[number];
type Window = (typeof LEADERBOARD_WINDOWS)[number];

/** Rolling install+fork ranking. Community and official are separate boards:
 *  the curated catalog ships with an audience that new authors cannot match,
 *  so mixing them would leave the community board permanently empty at the top. */
export function LeaderboardPanel({ onSelect }: { onSelect: (skill: Skill) => void }) {
  const t = useT();
  const [board, setBoard] = useState<Board>('community');
  const [window_, setWindow] = useState<Window>(7);
  const [entries, setEntries] = useState<RegistryLeaderboardEntry[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  // Probe both boards once. Deciding visibility from the selected board alone
  // would hide the board switcher along with the panel, leaving no way to
  // reach a board that does have data.
  useEffect(() => {
    let cancelled = false;
    Promise.all(LEADERBOARD_BOARDS.map(item =>
      workspaceApi.getRegistryLeaderboard(item, 30).then(list => list.length).catch(() => null),
    )).then(counts => {
      if (cancelled) return;
      // A null everywhere means the endpoint is missing — an older backend, or
      // migration 031 not applied yet. Stay out of the way in that case.
      if (counts.every(count => count === null)) { setAvailable(false); return; }
      setAvailable(counts.some(count => (count || 0) > 0));
      const firstWithData = LEADERBOARD_BOARDS[counts.findIndex(count => (count || 0) > 0)];
      if (firstWithData) setBoard(firstWithData);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    workspaceApi.getRegistryLeaderboard(board, window_)
      .then(list => { if (!cancelled) setEntries(list); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [board, window_]);

  // Nothing anywhere yet: an empty podium reads as a broken feature rather
  // than a young marketplace.
  if (available !== true) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Trophy className="size-3.5 text-warning" />
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('skills.leaderboard')}
        </h3>
        <div className="ms-auto flex items-center gap-1">
          <ToggleGroup
            type="single"
            size="sm"
            value={board}
            onValueChange={(v) => v && setBoard(v as Board)}
            aria-label={t('skills.leaderboard')}
          >
            {LEADERBOARD_BOARDS.map(item => (
              <ToggleGroupItem key={item} value={item}>
                {t(item === 'community' ? 'skills.boardCommunity' : 'skills.boardOfficial')}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Separator orientation="vertical" className="mx-1 h-3" />
          <ToggleGroup
            type="single"
            size="sm"
            value={String(window_)}
            onValueChange={(v) => v && setWindow(Number(v) as Window)}
          >
            {LEADERBOARD_WINDOWS.map(days => (
              <ToggleGroupItem key={days} value={String(days)}>
                {t(days === 7 ? 'skills.window7' : 'skills.window30')}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {entries === null ? (
        <Card size="sm" className="flex-row items-center gap-2 px-3.5 text-xs text-muted-foreground">
          <Spinner /> {t('common.loading')}
        </Card>
      ) : entries.length === 0 ? (
        <Card size="sm" className="px-3.5 text-xs text-muted-foreground">
          {t('skills.leaderboardEmpty')}
        </Card>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {entries.map(entry => (
            <button
              type="button"
              key={entry.id}
              onClick={() => onSelect(registrySkillToSkill(entry))}
              className="flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            >
              <span className={cn(
                'w-5 shrink-0 text-center text-xs font-semibold tabular-nums',
                entry.rank <= 3 ? 'text-warning' : 'text-muted-foreground',
              )}>
                {entry.rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {entry.namespaceName || entry.namespace}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('skills.leaderboardStats', {
                  installs: String(entry.windowInstalls),
                  forks: String(entry.windowForks),
                })}
              </span>
            </button>
          ))}
        </Card>
      )}
    </section>
  );
}
