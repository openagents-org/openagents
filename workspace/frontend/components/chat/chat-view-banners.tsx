'use client';

import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';
import type { AgentProbeEntry } from './use-agent-probes';

// Thread banners span the conversation's width, so they share the strip form
// of Alert: no rounding or side borders, only the bottom rule.
const STRIP = 'shrink-0 rounded-none border-x-0 border-t-0 px-2 lg:px-4';

/**
 * Offline-agent warning — surfaces when any participant is offline so the
 * user knows a reply may not come. When ALL are offline it's a stronger
 * notice; this banner is the only one, the backend posts nothing into the
 * thread for it. Shown for single-agent threads too, not just groups.
 */
export function OfflineAgentsBanner({ participants, agents }: { participants: string[]; agents: WorkspaceAgent[] }) {
  const t = useT();
  if (participants.length === 0) return null;
  const byName = new Map(agents.map((a) => [a.agentName, a]));
  const offline = participants.filter((p) => byName.get(p)?.status === 'offline');
  if (offline.length === 0) return null;
  const allOffline = offline.length === participants.length;
  return (
    <Alert role="status" className={`${STRIP} border-warning/30 bg-warning/10 text-warning`}>
      <AlertTriangle />
      <AlertDescription className="flex flex-wrap items-center gap-1.5 text-xs text-warning">
        <span>{allOffline ? t('chat.offlineAllAgents') : t('chat.offlineSomeAgents')}</span>
        {offline.map((name) => {
          const member = byName.get(name);
          return (
            <Badge key={name} variant="warning">
              <AgentAvatar name={name} size={14} />
              {member ? agentLabel(member) : name}
            </Badge>
          );
        })}
      </AlertDescription>
    </Alert>
  );
}

export type FailingProbe = { name: string; entry: AgentProbeEntry; dismissKey: string };

/**
 * Failing smoke test — a participant's last health check failed, so it will
 * likely not answer even if it shows online. Includes the probe's own guidance
 * so the user can fix it before starting a conversation.
 */
export function ProbeFailureBanner({ failing, retesting, onRetest, onDismiss }: {
  failing: FailingProbe[];
  retesting: Set<string>;
  onRetest: (name: string, nodeId: string, prevAt: string) => void;
  onDismiss: (key: string) => void;
}) {
  const t = useT();
  if (failing.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col">
      {failing.map(({ name, entry, dismissKey }) => {
        const busy = retesting.has(name);
        const guidance = (entry.probe.guidance || []).slice(0, 3);
        return (
          <Alert key={name} role="status" variant="destructive" className={`${STRIP} border-destructive/30 bg-destructive/10 has-data-[slot=alert-action]:pr-44`}>
            <AlertTriangle />
            <AlertTitle className="text-xs wrap-break-word">
              {t('chat.probeFailing', { agent: name })}
              {entry.probe.message ? ` — ${entry.probe.message}` : ''}
            </AlertTitle>
            {guidance.length > 0 && (
              <AlertDescription className="text-xs">
                {guidance.map((line, i) => <div key={i}>→ {line}</div>)}
              </AlertDescription>
            )}
            <AlertAction className="flex items-center gap-1 lg:right-4">
              <Button
                variant="outline"
                size="xs"
                onClick={() => onRetest(name, entry.nodeId, entry.probe.at)}
                disabled={busy}
                title={t('chat.probeRetest')}
              >
                {busy ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                {busy ? t('chat.probeRetesting') : t('chat.probeRetest')}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onDismiss(dismissKey)}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X aria-hidden="true" />
              </Button>
            </AlertAction>
          </Alert>
        );
      })}
    </div>
  );
}

/** No agent is connected yet: point at the Connect view. */
export function ConnectAgentNotice({ onConnect }: { onConnect: () => void }) {
  const t = useT();
  return (
    <Alert role="status" className={`${STRIP} flex items-center justify-between gap-3 bg-muted/50 py-1.5`}>
      <AlertDescription className="text-xs">{t('chat.connectAgentNotice')}</AlertDescription>
      <Button variant="link" size="xs" className="h-auto shrink-0 px-0" onClick={onConnect}>{t('nav.connectAgent')}</Button>
    </Alert>
  );
}
