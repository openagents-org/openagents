'use client';
import React from 'react';
import { CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { NodeAgent } from '@/lib/types';
import { HINT_ONLY_SIGN_IN, SAME_TYPE_SHOWN, type AgentSetupProps } from './agent-setup-types';
import { NeedsCredentialsHint } from './agent-setup-credentials-hint';
import type { runtimeStatus } from './agent-setup-status';
import type { AgentSetupForm } from './use-agent-setup-form';

type Status = ReturnType<typeof runtimeStatus>;

/** An outlined chip whose dot carries the state, as status chips are drawn
 *  across the app — not a tinted block. */
export function RuntimeStatusBadge({ status }: { status: Status }) {
  const t = useT();
  const map = {
    ready: { label: t('connect.nodeRuntimeReady'), dot: 'bg-success', text: '' },
    needs_login: { label: t('connect.nodeRuntimeNeedsLogin'), dot: 'bg-warning', text: '' },
    not_installed: { label: t('connect.nodeRuntimeWillInstall'), dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
    unknown: { label: '', dot: '', text: '' },
  } as const;
  const b = map[status];
  if (!b.label) return null;
  return (
    <Badge variant="outline" className={b.text}>
      <span className={cn('size-1.5 rounded-full', b.dot)} />
      {b.label}
    </Badge>
  );
}

/** What the device says about the chosen type, and what to do about it. */
export function AgentStatusHint({ form, node }: { form: AgentSetupForm; node: AgentSetupProps['node'] }) {
  const t = useT();
  const { selected, selectedEntry, selectedStatus, detail, runtimeByType, creds } = form;
  const label = selectedEntry?.label || selected || '';
  const Icon = selectedStatus === 'ready' ? CheckCircle2 : selectedStatus === 'needs_login' ? TriangleAlert : Info;
  return (
    <Alert data-testid="agent-setup-status-hint">
      <Icon className={selectedStatus === 'ready' ? 'text-success' : selectedStatus === 'needs_login' ? 'text-warning' : 'text-muted-foreground'} />
      {/* Room for the sign-in steps: no paragraph gaps, and download links stay buttons. */}
      <AlertDescription className="[&_a[data-slot=button]]:no-underline [&_p:not(:last-child)]:mb-0">
        {selectedStatus === 'ready' && t('connect.nodeReadyHint')}
        {selectedStatus === 'needs_login' && (detail?.provider_locked
          ? t('connect.nodeProviderLockedHint', { label })
          : <NeedsCredentialsHint
              label={label}
              device={node.name || node.hostname || ''}
              // A device new enough to have `agn login` says so; an older
              // one gets the CLI's own command.
              command={(selected && runtimeByType[selected]?.loginCommand) || creds.loginCommand
                || (selected && HINT_ONLY_SIGN_IN[selected]?.command) || ''}
              note={selected ? HINT_ONLY_SIGN_IN[selected]?.note : undefined}
              os={node.os}
            />)}
        {(selectedStatus === 'not_installed' || selectedStatus === 'unknown') && t('connect.nodeWillInstallHint')}
      </AlertDescription>
    </Alert>
  );
}

/** Provider-locked agents (Cursor): the ONLY credentials that work are the
 *  vendor's own — spell out both paths so the key field isn't a guessing game,
 *  and nobody pastes an OpenAI/relay key that can never authenticate. */
export function ProviderLockedHow({ form }: { form: AgentSetupForm }) {
  const t = useT();
  const { selected, selectedEntry, detail } = form;
  const label = selectedEntry?.label || selected || '';
  return (
    <Alert>
      <Info />
      <AlertTitle>{t('connect.nodeProviderLockedHow', { label })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 [&_p:not(:last-child)]:mb-0">
        {detail?.check_ready?.login_command && (
          <p>
            {t('connect.nodeProviderLockedLogin')}{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{detail.check_ready.login_command}</code>
          </p>
        )}
        <p>
          {t('connect.nodeProviderLockedKey', { label })}
          {selectedEntry?.homepage && (
            <>
              {' '}
              <a href={selectedEntry.homepage} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                {selectedEntry.homepage.replace(/^https?:\/\//, '')}
              </a>
            </>
          )}
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** Agents of the chosen type already on this device, to open instead. */
export function SameTypeAgents({ form, agents, onManageAgent }: { form: AgentSetupForm; agents: NodeAgent[]; onManageAgent: (agent: NodeAgent) => void }) {
  const t = useT();
  const { showAllSameType, setShowAllSameType, busy } = form;
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-4">
      <p className="text-xs font-medium">{t('connect.agentAlreadyHere')}</p>
      <ItemGroup className="gap-1">
        {(showAllSameType ? agents : agents.slice(0, SAME_TYPE_SHOWN)).map((agent) => (
          <Item key={agent.name} size="xs" className="px-0">
            <ItemContent><ItemTitle className="truncate">{agent.name}</ItemTitle></ItemContent>
            <ItemActions>
              <Button variant="link" size="xs" className="h-auto px-0" disabled={busy} onClick={() => onManageAgent(agent)}>
                {t('connect.agentOpenExisting')} →
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {/* A long list pushed the form, and its Add button, out of sight. */}
      {agents.length > SAME_TYPE_SHOWN && (
        <Button variant="link" size="xs" className="h-auto self-start px-0 text-muted-foreground hover:text-foreground" onClick={() => setShowAllSameType((v) => !v)}>
          {showAllSameType ? t('connect.agentShowFewer') : t('connect.agentShowAll', { count: agents.length })}
        </Button>
      )}
    </div>
  );
}
