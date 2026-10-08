'use client';
import { Circle, CircleCheck, CircleDot } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { IssueStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { cn } from '@/lib/utils';

export const statuses: IssueStatus[] = ['open', 'in_progress', 'closed'];
export const statusKeys = {
  open: 'issues.open',
  in_progress: 'issues.inProgress',
  closed: 'issues.closed',
} as const;
export const selectClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const authorName = (source: string) =>
  source.replace(/^(human:|openagents:)/, '');

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const detail = JSON.parse(message.slice(message.indexOf('{'))).detail;
    if (typeof detail === 'string') return detail;
  } catch {
    /* non-JSON network error */
  }
  return message;
}

export function StatusIcon({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  const Icon =
    status === 'closed'
      ? CircleCheck
      : status === 'in_progress'
        ? CircleDot
        : Circle;
  return (
    <Icon
      aria-hidden
      className={cn(
        'size-4 shrink-0',
        status === 'open'
          ? 'text-muted-foreground'
          : status === 'in_progress'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-violet-600 dark:text-violet-400',
        className,
      )}
      strokeWidth={1.8}
    />
  );
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs font-medium text-foreground/80">
      <StatusIcon status={status} className="size-3.5" />
      {t(statusKeys[status])}
    </span>
  );
}

/** Humans have quiet initial avatars; agents keep their workspace identity. */
export function IssueAvatar({
  name,
  source,
  size = 28,
}: {
  name: string;
  source?: string;
  size?: number;
}) {
  if (source?.startsWith('openagents:'))
    return (
      <span title={name} className="shrink-0">
        <AgentAvatar name={authorName(source)} size={size} />
      </span>
    );
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((part) => Array.from(part)[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return (
    <span
      title={name}
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted text-[10px] font-medium text-foreground/70"
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function IssueSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse motion-reduce:animate-none',
        detail ? 'space-y-6 py-8' : 'divide-y divide-border/60',
      )}
    >
      {Array.from({ length: detail ? 3 : 5 }, (_, index) => (
        <div key={index} className={cn('flex gap-3', !detail && 'px-6 py-5')}>
          <div className="mt-1 size-5 rounded-full bg-muted" />
          <div className="flex-1 space-y-3">
            <div
              className={cn(
                'h-3 rounded bg-muted',
                index % 2 ? 'w-2/5' : 'w-3/5',
              )}
            />
            <div className="h-2.5 w-1/3 rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {message}
      {retry && (
        <Button variant="ghost" size="sm" onClick={retry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
