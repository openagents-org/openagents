'use client';
import { AlertTriangle, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { deviceNameClash } from '@/lib/node-command-error';
import { ExpandableError } from './expandable-error';
import type { PendingAgent } from './node-card';

/** Past this a placeholder that is not tied to a running command has stalled. */
const PENDING_STALL_MS = 120_000;

/**
 * Where an agent being added stands, step by step: queued until the device
 * picks the command up (`waiting`), installed and configured there
 * (`installing`), then joining the workspace until the device reports it
 * (`starting`). While the command is pending or running the spinner is the
 * true state, not a guess — a queued install of a large runtime takes
 * minutes, and an offline device runs it when it reconnects. A placeholder
 * that outlives any realistic join otherwise has stalled: the agent failed to
 * come up or lost its workspace binding, and saying so beats a spinner that
 * never ends.
 */
export function pendingState(p: PendingAgent): 'failed' | 'waiting' | 'installing' | 'stalled' | 'starting' {
  if (p.cmdStatus === 'error') return 'failed';
  if (p.commandId && (!p.cmdStatus || p.cmdStatus === 'pending')) return 'waiting';
  if (p.commandId && p.cmdStatus === 'running') return 'installing';
  if (typeof p.at === 'number' && Date.now() - p.at > PENDING_STALL_MS) return 'stalled';
  return 'starting';
}

/** An agent being added, shown until the device reports it. */
export function NodePendingAgent({
  pending: p,
  deviceOnline,
  onRetry,
  onRecheck,
  onDismiss,
}: {
  pending: PendingAgent;
  deviceOnline: boolean;
  /** Reopen the add form as it was submitted. */
  onRetry: () => void;
  /** Ask the device list again whether the agent has joined. */
  onRecheck: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const state = pendingState(p);
  const clash = state === 'failed' ? deviceNameClash(p.cmdMessage) : null;
  const badge = {
    failed: { variant: 'destructive' as const, icon: <AlertTriangle />, text: t('connect.nodeAgentFailed') },
    stalled: { variant: 'warning' as const, icon: <AlertTriangle />, text: t('connect.nodeAgentStalled') },
    waiting: { variant: 'info' as const, icon: <Spinner data-icon="inline-start" />, text: t('connect.nodeAgentWaiting') },
    installing: { variant: 'info' as const, icon: <Spinner data-icon="inline-start" />, text: t('connect.nodeAgentInstalling') },
    starting: { variant: 'info' as const, icon: <Spinner data-icon="inline-start" />, text: t('connect.nodeAgentStarting') },
  }[state];

  return (
    <Item variant="outline" size="sm" role="listitem" className="animate-in border-dashed fade-in">
      <ItemMedia>
        <AgentIcon name={p.type} size={32} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="max-w-full truncate">@{p.name}</ItemTitle>
        <ItemDescription className="truncate text-xs">{p.type}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant={badge.variant}>{badge.icon}{badge.text}</Badge>
      </ItemActions>

      <ItemFooter className="flex-col items-stretch gap-2">
        {state === 'failed' ? (
          <>
            <ExpandableError
              message={clash ? t('connect.agentNameOnDevice', { name: clash }) : p.cmdMessage || t('connect.nodeAgentFailedHint')}
              className="text-xs text-destructive"
            />
            {/* The same action row as a live agent: Edit reopens the form as it
                was submitted, so a failed add is fixed rather than retyped. */}
            <div className="flex items-center gap-1 border-t pt-2">
              {p.draft && (
                <Button size="sm" variant="ghost" onClick={onRetry}>
                  <Pencil data-icon="inline-start" />{t('connect.nodeEdit')}
                </Button>
              )}
              <WithTooltip label={t('connect.remove')}><Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={onDismiss}
                    className="ms-auto text-muted-foreground"
                    aria-label={t('connect.remove')}
                  >
                    <Trash2 />
                  </Button></WithTooltip>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 border-t border-dashed pt-2 text-xs">
            {state === 'stalled' ? (
              <>
                <span className="min-w-0 flex-1 text-warning">{t('connect.nodeAgentStalledHint')}</span>
                <Button size="sm" variant="ghost" onClick={onRecheck}>
                  <RefreshCw data-icon="inline-start" />{t('connect.nodeAgentRecheck')}
                </Button>
                <WithTooltip label={t('connect.remove')}><Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={onDismiss}
                      className="text-muted-foreground"
                      aria-label={t('connect.remove')}
                    >
                      <Trash2 />
                    </Button></WithTooltip>
              </>
            ) : (
              <>
                <span className="relative flex size-2 items-center justify-center">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40" />
                  <span className="size-1.5 rounded-full bg-primary" />
                </span>
                <span className="text-muted-foreground">
                  {state === 'waiting'
                    ? t(deviceOnline ? 'connect.nodeAgentWaitingHint' : 'connect.nodeAgentWaitingOfflineHint')
                    : state === 'installing' ? t('connect.nodeAgentInstallingHint') : t('connect.nodeAgentSpinningUp')}
                </span>
              </>
            )}
          </div>
        )}
      </ItemFooter>
    </Item>
  );
}
