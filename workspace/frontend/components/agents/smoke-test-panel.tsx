'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { NodeProbe } from '@/lib/types';
import type { AgentSetupApi } from './agent-setup';

/** How long to wait for the device to report back before calling it a timeout. */
const RESULT_TIMEOUT_MS = 150_000;

type Outcome =
  | { kind: 'live'; probe: NodeProbe }
  /** The agent type has no live check: only install + sign-in were verified. */
  | { kind: 'static'; probe: NodeProbe }
  | { kind: 'never' };

function outcomeOf(probe: NodeProbe | null | undefined): Outcome {
  if (!probe) return { kind: 'never' };
  return probe.code === 'static_only' ? { kind: 'static', probe } : { kind: 'live', probe };
}

/**
 * Smoke-test panel: the last "hi"-probe result the daemon reported for this
 * AGENT on this node (probes are per agent — run after create and reconfigure,
 * then hourly), plus a button to run it again (queues a `probe_agent` node
 * command; the fresh result arrives via the heartbeat's agents[].probe on the
 * next poll).
 */
export function SmokeTestPanel({ api, nodeId, agentName, probe, onChanged }: {
  api: AgentSetupApi;
  nodeId: string;
  agentName: string;
  probe: NodeProbe | null | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  // Stop the spinner as soon as a fresh result lands (its timestamp changes).
  const lastAt = useRef(probe?.at);
  useEffect(() => {
    if (probe?.at !== lastAt.current) {
      lastAt.current = probe?.at;
      clearTimers();
      setTesting(false);
      setTimedOut(false);
    }
  }, [probe?.at]);

  const outcome = outcomeOf(probe);

  const run = async () => {
    clearTimers();
    setTesting(true);
    setTimedOut(false);
    try {
      await api.enqueueNodeCommand(nodeId, 'probe_agent', { name: agentName });
      // Nudge the node poll a few times while the probe runs on the device;
      // a probe can take up to its CLI timeout, so keep the spinner bounded.
      timers.current = [
        setTimeout(onChanged, 8000),
        setTimeout(onChanged, 20000),
        setTimeout(onChanged, 45000),
        setTimeout(() => { setTesting(false); setTimedOut(true); }, RESULT_TIMEOUT_MS),
      ];
    } catch {
      toast.error(t('connect.nodeCommandFailed'));
      setTesting(false);
    }
  };

  const failed = outcome.kind !== 'never' && outcome.probe.ok !== true;

  return (
    <div className="rounded-xl border px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 text-xs">
          <span className="font-medium shrink-0">{t('connect.smokeTestTitle')}</span>
          {testing ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />{t('connect.smokeTestRunning')}
            </span>
          ) : timedOut ? (
            <span className="text-amber-600 dark:text-amber-400">{t('connect.smokeTestTimedOut')}</span>
          ) : outcome.kind === 'never' ? (
            <span className="text-muted-foreground">{t('connect.smokeTestNever')}</span>
          ) : (
            <span className={cn(
              'inline-flex items-center gap-1.5 min-w-0',
              failed ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400',
            )}>
              {failed ? <X className="size-3 shrink-0" /> : <Check className="size-3 shrink-0" />}
              {outcome.kind === 'static'
                ? t(failed ? 'connect.smokeTestStaticFailed' : 'connect.smokeTestStaticPassed')
                : t(failed ? 'connect.smokeTestFailed' : 'connect.smokeTestPassed')}
              <span className="text-muted-foreground truncate">
                {t('connect.smokeTestAt', { time: new Date(outcome.probe.at).toLocaleString() })}
              </span>
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shrink-0" onClick={run} disabled={testing}>
          {outcome.kind === 'never' ? t('connect.smokeTestRun') : t('connect.smokeTestRerun')}
        </Button>
      </div>
      {!testing && timedOut && (
        <p className="text-xs text-muted-foreground">{t('connect.smokeTestTimedOutHint')}</p>
      )}
      {!testing && !timedOut && outcome.kind === 'static' && !failed && (
        <p className="text-xs text-muted-foreground">{t('connect.smokeTestStaticHint')}</p>
      )}
      {!testing && !timedOut && outcome.kind !== 'never' && failed && (
        <div className="space-y-1.5">
          {outcome.probe.message && (
            <p className="text-xs text-red-600/90 dark:text-red-400/90 break-words">{outcome.probe.message}</p>
          )}
          {(outcome.probe.guidance || []).length > 0 && (
            <ul className="space-y-1">
              {(outcome.probe.guidance || []).map((line, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-1.5">
                  <ArrowRight className="size-3 mt-0.5 shrink-0" />
                  <span className="break-words">{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
