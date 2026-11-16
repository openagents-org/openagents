'use client';
import { AlertCircle, Circle, CircleCheck, CircleDot, CirclePause } from 'lucide-react';
import { useFormatters, useT } from '@/lib/i18n';
import type { IssueStatus } from '@/lib/types';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { cn } from '@/lib/utils';

export const statuses: IssueStatus[] = ['open', 'in_progress', 'paused', 'closed'];
export const statusKeys = {
  open: 'issues.open',
  in_progress: 'issues.inProgress',
  closed: 'issues.closed',
  paused: 'issues.paused',
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Issue timestamps. `label` reads "3 hours ago" for the past week and the
 * exact day and minute after that, so old issues can be traced to a date.
 * `exact` always gives the full date and minute, for tooltips.
 */
export function useIssueTime() {
  const { timeAgo, formatDateTime } = useFormatters();
  const exactOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return {
    label: (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      if (Date.now() - date.getTime() < WEEK_MS) return timeAgo(value);
      return formatDateTime(value, {
        ...exactOptions,
        year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      });
    },
    exact: (value: string) => formatDateTime(value, exactOptions),
  };
}

/** Asks before an issue is deleted; resolves true when the person confirms. */
export function useConfirmIssueDelete() {
  const t = useT();
  const confirm = useConfirm();
  return (title: string) => confirm({
    title: t('issues.deleteTitle', { title }),
    description: t('issues.deleteDescription'),
    confirmText: t('common.delete'),
    destructive: true,
  });
}

export function StatusIcon({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  const Icon =
    status === 'paused' ? CirclePause : status === 'closed'
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
            ? 'text-warning'
            : status === 'closed'
              ? 'text-success'
              : 'text-muted-foreground',
        className,
      )}
      strokeWidth={1.8}
    />
  );
}

/** Match the human and agent identities used throughout the workspace. */
export function IssueAvatar({
  name,
  source,
  size = 28,
}: {
  name: string;
  source?: string;
  size?: number;
}) {
  if (source?.startsWith('human:'))
    return <span title={name} className="inline-flex shrink-0" style={{ width: size, height: size }}><HumanAvatar email={source.slice(6)} className="size-full [&_svg]:size-3" /></span>;
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
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted text-xs font-medium text-foreground/70"
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function IssueSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div aria-hidden className={cn(detail ? 'flex flex-col gap-6 py-8' : 'divide-y divide-border/60')}>
      {Array.from({ length: detail ? 3 : 5 }, (_, index) => (
        <div key={index} className={cn('flex gap-3', !detail && 'px-6 py-5')}>
          <Skeleton className="mt-1 size-5 rounded-full" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className={cn('h-3', index % 2 ? 'w-2/5' : 'w-3/5')} />
            <Skeleton className="h-2.5 w-1/3" />
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
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription className={cn(retry && 'pr-16')}>{message}</AlertDescription>
      {retry && (
        <AlertAction>
          <Button variant="outline" size="xs" onClick={retry}>
            {t('common.retry')}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
