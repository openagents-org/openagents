'use client';
import { Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { AgentSharingButton } from '@/components/sharing/agent-sharing-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import type { NodeAgent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ExpandableError } from './expandable-error';
import type { AgentToggle } from './use-agent-toggles';

/**
 * One agent on a device: who it is and its state, the model it runs, a failing
 * check if it has one, then Start/Stop (or Restart), Edit, Share and Remove.
 */
export function NodeAgentItem({
  agent: a,
  online,
  busy,
  toggling,
  statusLabel,
  onToggle,
  onEdit,
  onRemove,
}: {
  agent: NodeAgent;
  online: boolean;
  busy: boolean;
  /** The Start/Stop/Restart in flight for this agent, if any. */
  toggling?: AgentToggle;
  statusLabel: string;
  onToggle: (action: AgentToggle['action']) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const running = a.status === 'running';
  const tone = online && running ? 'success' : online && a.status === 'error' ? 'destructive' : 'secondary';

  return (
    <Item variant="outline" size="sm" role="listitem" className="bg-background">
      <ItemMedia>
        <AgentIcon name={a.type} size={32} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="max-w-full">
          <button disabled={busy} onClick={onEdit} className="truncate text-left hover:underline">
            {a.displayName || `@${a.name}`}
          </button>
        </ItemTitle>
        <ItemDescription className="truncate text-xs">
          {a.displayName ? `@${a.name} · ${a.type}` : a.type}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant={tone}>
          <span className={cn('size-1.5 rounded-full', tone === 'success' ? 'bg-success' : tone === 'destructive' ? 'bg-destructive' : 'bg-muted-foreground/60')} />
          {statusLabel}
        </Badge>
      </ItemActions>

      <ItemFooter className="flex-col items-stretch gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">{t('connect.nodeModelDefault')}:</span>
          <span className="truncate font-mono">{a.model || t('connect.nodeModelAutoShort')}</span>
          {/* Sign-in or key: two agents of one type on one device can run on
              either, and nothing else here says which. */}
          {a.authMode && (
            <Badge variant="secondary" data-testid="node-agent-auth" className="font-normal">
              {t(a.authMode === 'api_key' ? 'connect.agentAuthApiKey' : 'connect.agentAuthCliLogin')}
            </Badge>
          )}
        </div>

        {/* A failing smoke test — the agent will likely not answer. */}
        {a.probe && a.probe.ok === false && a.probe.code !== 'static_only' && (
          <div className="flex items-start gap-1.5 text-xs text-destructive">
            <X className="mt-px size-3 shrink-0" />
            <ExpandableError message={a.probe.message || t('connect.smokeTestFailed')} />
          </div>
        )}

        <div className="flex items-center gap-1 border-t pt-2">
          {toggling ? (
            <Button size="sm" variant="ghost" disabled>
              <Spinner data-icon="inline-start" />
              {t(toggling.action === 'restart' ? 'connect.nodeRestarting'
                : toggling.action === 'stop_agent' ? 'connect.nodeStopping' : 'connect.nodeStarting')}
            </Button>
          ) : a.status === 'error' ? (
            <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => onToggle('restart')}>
              <RotateCcw data-icon="inline-start" />{t('connect.nodeRestart')}
            </Button>
          ) : running ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggle('stop_agent')}>
              {t('connect.nodeStop')}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggle('start_agent')}>
              {t('connect.nodeStart')}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
            <Pencil data-icon="inline-start" />{t('connect.nodeEdit')}
          </Button>
          <AgentSharingButton agentName={a.name} />
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRemove}
            disabled={busy}
            className="ms-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title={t('connect.remove')}
            aria-label={t('connect.remove')}
          >
            <Trash2 />
          </Button>
        </div>
      </ItemFooter>
    </Item>
  );
}
