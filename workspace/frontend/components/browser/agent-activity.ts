'use client';

/**
 * "Who is driving this tab right now?"
 *
 * Two signals feed the answer:
 *  - `tab.activity` from the tab listing — the backend stamps the last agent
 *    action (click/type/navigate…) with a short TTL, so it survives a page
 *    reload and reaches the sidebar, which has no live view.
 *  - `postMessage` from the BrowserFabric live view inside the iframe — the
 *    cloud browser announces each agent action the instant it happens, which
 *    is what makes the "agent is clicking" state and the enlarged cursor feel
 *    live instead of a poll behind.
 */

import { useEffect, useMemo, useState } from 'react';
import type { BrowserTab, WorkspaceAgent } from '@/lib/types';
import { agentLabel } from '@/lib/helpers';

/** How long after the last action a tab still counts as "agent is browsing". */
export const ACTIVITY_FRESH_MS = 15_000;

/** `event.data.type` of the messages the BrowserFabric live view posts to its parent. */
export const AGENT_ACTION_MESSAGE = 'browserfabric:agent-action';

export const AGENT_ACTIONS = ['click', 'type', 'navigate', 'press_key', 'evaluate', 'scroll', 'hover'] as const;
export type KnownAgentAction = (typeof AGENT_ACTIONS)[number];

export function knownAction(action: string | null | undefined): KnownAgentAction | 'other' {
  return (AGENT_ACTIONS as readonly string[]).includes(action || '') ? (action as KnownAgentAction) : 'other';
}

export function isAgentActor(actor: string | null | undefined): boolean {
  return !!actor && actor.startsWith('openagents:');
}

/** Display name for an actor id such as `openagents:scout` or `human:user`. */
export function actorName(actor: string | null | undefined, agents: WorkspaceAgent[]): string | null {
  if (!actor) return null;
  const name = actor.replace(/^(openagents:|human:)/, '');
  const agent = agents.find((a) => a.agentName === name);
  return agent ? agentLabel(agent) : name;
}

export function liveUrlOrigin(liveUrl: string | null | undefined): string | null {
  if (!liveUrl) return null;
  try {
    return new URL(liveUrl).origin;
  } catch {
    return null;
  }
}

/** Sidebar-grade check from the polled signal alone. */
export function tabHasFreshAgentActivity(tab: BrowserTab, now = Date.now()): boolean {
  const a = tab.activity;
  if (!a || !isAgentActor(a.actor)) return false;
  const at = Date.parse(a.at);
  return Number.isFinite(at) && now - at < ACTIVITY_FRESH_MS;
}

export interface AgentActivityState {
  /** An agent acted within {@link ACTIVITY_FRESH_MS}. */
  active: boolean;
  action: KnownAgentAction | 'other' | null;
  /** Actor id (`openagents:<name>`) when known; the live view doesn't know it. */
  actor: string | null;
  at: number | null;
}

/**
 * Merges the polled and the pushed signal for one tab, and re-renders once
 * the freshness window closes so the "agent is browsing" state clears itself.
 */
export function useAgentActivity(tab: BrowserTab | undefined): AgentActivityState {
  const tabId = tab?.id;
  const origin = liveUrlOrigin(tab?.liveUrl);
  const [pushed, setPushed] = useState<{ action: string; at: number } | null>(null);
  const [, setTick] = useState(0);

  // A new tab is a new story — forget what the previous iframe said.
  useEffect(() => {
    setPushed(null);
  }, [tabId]);

  useEffect(() => {
    if (!origin) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const d = e.data as { type?: string; action?: string } | null;
      if (!d || d.type !== AGENT_ACTION_MESSAGE) return;
      setPushed({ action: String(d.action || 'other'), at: Date.now() });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin]);

  const polled = useMemo(() => {
    const a = tab?.activity;
    if (!a || !isAgentActor(a.actor)) return null;
    const at = Date.parse(a.at);
    return Number.isFinite(at) ? { action: a.action, actor: a.actor, at } : null;
  }, [tab?.activity]);

  const latestAt = Math.max(pushed?.at ?? 0, polled?.at ?? 0);
  const latest = latestAt === 0 ? null : (pushed && pushed.at >= (polled?.at ?? 0) ? pushed : polled);
  const active = !!latest && Date.now() - latest.at < ACTIVITY_FRESH_MS;

  // Tick once a second only while something is fresh, so the state expires
  // on its own without a permanent timer.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [active, latestAt]);

  return {
    active,
    action: latest ? knownAction(latest.action) : null,
    actor: polled?.actor ?? null,
    at: latest?.at ?? null,
  };
}
