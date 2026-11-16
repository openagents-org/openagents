'use client';

import { CircleDot, Plus } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { IssueStatus, WorkspaceIssue } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { StatusIcon, statusKeys } from './issue-ui';

/** No issues at all, or none matching the filters. */
export function IssuesEmpty({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  const t = useT();
  return (
    <Empty className="mx-auto max-w-sm px-6 py-24">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleDot />
        </EmptyMedia>
        <EmptyTitle>{t(filtered ? 'issues.noMatches' : 'issues.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t(filtered ? 'issues.noMatchesHint' : 'issues.emptyDescription')}</EmptyDescription>
      </EmptyHeader>
      {!filtered && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {t('issues.newIssue')}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/** Board view: one column per status, cards rendered by `card`. */
export function IssueBoardColumns({ statuses, issues, card }: {
  statuses: IssueStatus[];
  issues: WorkspaceIssue[];
  card: (issue: WorkspaceIssue) => React.ReactNode;
}) {
  const t = useT();
  return (
    <div className={cn('grid min-h-full grid-cols-1 gap-6 bg-muted/15 p-5 sm:px-8 sm:py-6', statuses.length > 1 && 'sm:grid-cols-2')}>
      {statuses.map((value) => {
        const column = issues.filter((issue) => issue.status === value);
        return (
          <section key={value} className="min-w-0">
            <div className="mb-4 flex items-center gap-2.5 px-1">
              <StatusIcon status={value} />
              <h2 className="text-xs font-medium">{t(statusKeys[value])}</h2>
              <Badge variant="secondary" className="tabular-nums">{column.length}</Badge>
            </div>
            <div className="flex flex-col gap-3">
              {column.map(card)}
              {!column.length && (
                <Empty className="border border-dashed border-border/60 px-4 py-8">
                  <EmptyDescription className="text-xs">{t('issues.emptyColumn')}</EmptyDescription>
                </Empty>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
