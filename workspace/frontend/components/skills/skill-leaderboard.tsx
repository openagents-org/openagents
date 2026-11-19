'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { RegistryLeaderboardEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SkillLogo } from './skill-card';
import type { Skill } from './skill-types';
import { registrySkillToSkill, skillDescription } from './skill-utils';

const LEADERBOARD_BOARDS = ['community', 'official'] as const;
const LEADERBOARD_WINDOWS = [7, 30] as const;

type Board = (typeof LEADERBOARD_BOARDS)[number];
type Window = (typeof LEADERBOARD_WINDOWS)[number];

// Session-lived cache. The registry is public and slow-moving, so coming back
// to Skill Hub shows the last result at once and refreshes it quietly, instead
// of probing from scratch and popping the card in again on every visit.
let probeCache: { available: boolean; board: Board } | null = null;
const entriesCache = new Map<string, RegistryLeaderboardEntry[]>();
const cacheKey = (board: Board, window: Window) => `${board}:${window}`;

/** Rolling install+fork ranking. Community and official are separate boards:
 *  the curated catalog ships with an audience that new authors cannot match,
 *  so mixing them would leave the community board permanently empty at the top.
 *  Laid out like the shadcn dashboard-01 cards: title and a description that
 *  says what is being ranked, the switches in CardAction, a table below. */
export function LeaderboardPanel({ onSelect }: { onSelect: (skill: Skill) => void }) {
  const t = useT();
  const [board, setBoard] = useState<Board>(probeCache?.board ?? 'community');
  const [window_, setWindow] = useState<Window>(7);
  const [entries, setEntries] = useState<RegistryLeaderboardEntry[] | null>(
    () => entriesCache.get(cacheKey(probeCache?.board ?? 'community', 7)) ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState<boolean | null>(probeCache?.available ?? null);

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
      const firstWithData = LEADERBOARD_BOARDS[counts.findIndex(count => (count || 0) > 0)];
      const hasData = counts.some(count => (count || 0) > 0);
      // A revisit keeps the board the card already opened on; only the first
      // probe picks the board that has data.
      if (firstWithData && !probeCache) setBoard(firstWithData);
      probeCache = { available: hasData, board: probeCache?.board ?? firstWithData ?? 'community' };
      setAvailable(hasData);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // A cached result shows at once and is refreshed underneath. Without one,
    // the previous rows stay up, dimmed, until the new ones land: swapping in
    // skeletons on every switch would collapse the table and jump the page.
    const key = cacheKey(board, window_);
    const cached = entriesCache.get(key);
    if (cached) setEntries(cached);
    setLoading(!cached);
    workspaceApi.getRegistryLeaderboard(board, window_)
      .then(list => {
        entriesCache.set(key, list);
        if (!cancelled) setEntries(list);
      })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [board, window_]);

  // Nothing anywhere yet: an empty podium reads as a broken feature rather
  // than a young marketplace. While the first probe runs, the card is already
  // drawn with skeleton rows so it does not pop in and shove the page down.
  if (available === false) return null;
  const probing = available === null;

  return (
    <Card className="@container/card pb-0">
      <CardHeader>
        <CardTitle>{t('skills.leaderboard')}</CardTitle>
        <CardDescription>
          {t(board === 'community' ? 'skills.leaderboardCommunityDescription' : 'skills.leaderboardOfficialDescription')}
        </CardDescription>
        {/* Narrow cards move the switches under the description instead of
            squeezing the title column. */}
        <CardAction className="flex flex-wrap items-center gap-2 @max-md/card-header:col-start-1 @max-md/card-header:row-span-1 @max-md/card-header:row-start-3 @max-md/card-header:justify-self-start">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            disabled={probing}
            value={board}
            onValueChange={(v) => v && setBoard(v as Board)}
            aria-label={t('skills.leaderboard')}
          >
            {LEADERBOARD_BOARDS.map(item => (
              <ToggleGroupItem key={item} value={item} className="px-3">
                {t(item === 'community' ? 'skills.boardCommunity' : 'skills.boardOfficial')}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select disabled={probing} value={String(window_)} onValueChange={(v) => setWindow(Number(v) as Window)}>
            <SelectTrigger size="sm" aria-label={t('skills.leaderboardWindow')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {LEADERBOARD_WINDOWS.map(days => (
                <SelectItem key={days} value={String(days)}>
                  {t(days === 7 ? 'skills.window7' : 'skills.window30')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      {probing || entries === null ? (
        <LeaderboardSkeleton />
      ) : entries.length === 0 ? (
        <CardContent aria-busy={loading} className={cn('pb-4 transition-opacity', loading && 'opacity-60')}>
          <Empty className="border border-dashed py-8">
            <EmptyDescription>{t('skills.leaderboardEmpty')}</EmptyDescription>
          </Empty>
        </CardContent>
      ) : (
        <CardContent
          aria-busy={loading}
          className={cn('border-t px-0 transition-opacity animate-in fade-in-0 duration-200', loading && 'opacity-60')}
        >
          <LeaderboardTable entries={entries} onSelect={onSelect} />
        </CardContent>
      )}
    </Card>
  );
}

/** Placeholder shaped like the table (header strip, logo + two-line rows), so
 *  the real rows replace it without the card changing much in height. */
function LeaderboardSkeleton() {
  return (
    <CardContent aria-busy className="flex flex-col border-t px-0">
      <div className="h-10 bg-muted/50" />
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-2 last:border-0">
          <Skeleton className="h-4 w-5" />
          <Skeleton className="size-8 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-4 w-8" />
        </div>
      ))}
    </CardContent>
  );
}

function LeaderboardTable({
  entries,
  onSelect,
}: {
  entries: RegistryLeaderboardEntry[];
  onSelect: (skill: Skill) => void;
}) {
  const t = useT();
  const rows = useMemo(() => entries.map(entry => ({ entry, skill: registrySkillToSkill(entry) })), [entries]);
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-14 ps-4 text-muted-foreground">{t('skills.leaderboardRank')}</TableHead>
          <TableHead className="text-muted-foreground">{t('skills.leaderboardSkill')}</TableHead>
          <TableHead className="hidden text-muted-foreground @lg/card:table-cell">{t('skills.leaderboardPublisher')}</TableHead>
          <TableHead className="text-right text-muted-foreground">{t('skills.leaderboardInstalls')}</TableHead>
          <TableHead className="pe-4 text-right text-muted-foreground">{t('skills.leaderboardForks')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ entry, skill }) => {
          const description = skillDescription(t, skill);
          return (
            // The whole row is a pointer target; the name button is the
            // keyboard one, and stops propagation so a click selects once.
            <TableRow key={entry.id} className="cursor-pointer" onClick={() => onSelect(skill)}>
              <TableCell className={cn(
                'ps-4 tabular-nums',
                entry.rank <= 3 ? 'font-medium' : 'text-muted-foreground',
              )}>
                {entry.rank}
              </TableCell>
              {/* max-w-0 + w-full lets the name and summary truncate instead of
                  pushing the number columns out of the card. */}
              <TableCell className="w-full max-w-0">
                <div className="flex items-center gap-3">
                  <SkillLogo skill={skill} size="sm" />
                  <div className="flex min-w-0 flex-col">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelect(skill); }}
                      className="truncate text-left font-medium outline-none focus-visible:underline"
                    >
                      {entry.name}
                    </button>
                    {description && (
                      <span className="truncate text-xs text-muted-foreground">{description}</span>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden text-muted-foreground @lg/card:table-cell">
                {entry.namespaceName || entry.namespace}
              </TableCell>
              <TableCell className="text-right tabular-nums">{entry.windowInstalls}</TableCell>
              <TableCell className="pe-4 text-right tabular-nums">{entry.windowForks}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
