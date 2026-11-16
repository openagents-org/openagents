'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { desktopHost } from '@/lib/desktop-host';
import { useT } from '@/lib/i18n';
import { nodeCommandErrorKey } from '@/lib/node-command-error';
import type { NodeAgent, NodeCommand, WorkspaceNode } from '@/lib/types';

/**
 * A Start/Stop sent to a device, shown on the card until its state moves off
 * `from`. A restart is a stop and then a start: the start waits until the
 * device reports the stop done, since a start that finds the agent's process
 * still up is skipped. It ends when the agent runs again.
 */
export interface AgentToggle {
  action: 'start_agent' | 'stop_agent' | 'restart';
  /** The roster status when the button was clicked. */
  from: string;
  at: number;
  commandId?: string;
  /** Restart only: which half is in flight. */
  phase?: 'stopping' | 'starting';
}

/** Past this the device is treated as not answering: a heartbeat is every 10s. */
const AGENT_TOGGLE_TIMEOUT_MS = 60_000;


/**
 * Start, Stop and Restart for a device's agents, tracked until the roster
 * reports the agent in another state — or the device reports the command
 * failed, or stops answering.
 */
export function useAgentToggles({
  node,
  agents,
  isThisComputer,
  onChanged,
}: {
  node: WorkspaceNode;
  agents: NodeAgent[];
  isThisComputer: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  // Start/Stop clicked on a card, until the roster shows the agent in another
  // state. The device only picks a command up on its next heartbeat, so the
  // card used to keep saying "Running" with a live Stop button for many
  // seconds, and the click read as doing nothing.
  const [toggling, setToggling] = useState<Record<string, AgentToggle>>({});
  const togglingNames = Object.keys(toggling);

  useEffect(() => {
    setToggling((prev) => {
      const next = { ...prev };
      for (const name of Object.keys(prev)) {
        const agent = agents.find((a) => a.name === name);
        const entry = prev[name];
        if (!agent) delete next[name];
        else if (entry.action === 'restart') {
          if (entry.phase === 'starting' && agent.status === 'running') delete next[name];
        } else if (agent.status !== entry.from) delete next[name];
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [agents]);

  // While a toggle is in flight, refresh the roster briskly and watch the
  // command itself, so a failure on the device is shown instead of a spinner.
  useEffect(() => {
    if (togglingNames.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      onChanged();
      let cmds: NodeCommand[] = [];
      try { cmds = await workspaceApi.listNodeCommands(node.nodeId); } catch { /* next tick retries */ }
      if (cancelled) return;
      // A restart whose stop has finished moves on to its start.
      for (const [name, entry] of Object.entries(togglingRef.current)) {
        const cmd = cmds.find((c) => c.commandId === entry.commandId);
        if (entry.action === 'restart' && entry.phase === 'stopping' && cmd?.status === 'done') void startAfterStop(name);
      }
      setToggling((prev) => {
        const next = { ...prev };
        for (const [name, entry] of Object.entries(prev)) {
          const cmd = cmds.find((c) => c.commandId === entry.commandId);
          const status = agentsRef.current.find((a) => a.name === name)?.status;
          if (cmd?.status === 'error') {
            toast.error(t(entry.action === 'restart' ? 'connect.nodeRestartFailed'
              : entry.action === 'stop_agent' ? 'connect.nodeStopFailed' : 'connect.nodeStartFailed', {
              name, message: cmd.result?.message || '',
            }));
            delete next[name];
          } else if (entry.action === 'restart' && entry.phase === 'starting' && cmd?.status === 'done' && status === 'error') {
            // Started, and failed again on the device.
            toast.error(t('connect.nodeRestartFailed', { name, message: '' }));
            delete next[name];
          } else if (Date.now() - entry.at > AGENT_TOGGLE_TIMEOUT_MS) {
            toast.error(t('connect.nodeToggleNoResponse', { name }));
            delete next[name];
          }
        }
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    };
    // 1s: on this computer the command now lands within a second (see
    // nudge below), and a 2s tick alone could add most of that again.
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [togglingNames.join('|'), node.nodeId]);

  // The device picks queued commands up on its heartbeat, every 10s. When it
  // is the computer this desktop app runs on, the app can make it check in
  // straight away, which is most of the wait behind a Start or Stop.
  const nudge = () => { if (isThisComputer) desktopHost()?.nudgeComputer?.(); };

  const togglingRef = useRef(toggling);
  togglingRef.current = toggling;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const startAfterStop = async (name: string) => {
    setToggling((prev) => (prev[name] ? { ...prev, [name]: { ...prev[name], phase: 'starting', commandId: undefined, at: Date.now() } } : prev));
    try {
      const cmd = await workspaceApi.enqueueNodeCommand(node.nodeId, 'start_agent', { name });
      nudge();
      setToggling((prev) => (prev[name] ? { ...prev, [name]: { ...prev[name], commandId: cmd.commandId } } : prev));
    } catch (err: unknown) {
      setToggling((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      const key = nodeCommandErrorKey(err instanceof Error ? err.message : '');
      toast.error(key ? t(key, { name }) : t('connect.nodeCommandFailed'));
    }
  };

  const toggleAgent = async (agent: NodeAgent, action: AgentToggle['action']) => {
    const restart = action === 'restart';
    setToggling((prev) => ({ ...prev, [agent.name]: { action, from: agent.status, at: Date.now(), ...(restart ? { phase: 'stopping' as const } : {}) } }));
    try {
      const cmd = await workspaceApi.enqueueNodeCommand(node.nodeId, restart ? 'stop_agent' : action, { name: agent.name });
      nudge();
      setToggling((prev) => (prev[agent.name] ? { ...prev, [agent.name]: { ...prev[agent.name], commandId: cmd.commandId } } : prev));
    } catch (err: unknown) {
      setToggling((prev) => {
        const next = { ...prev };
        delete next[agent.name];
        return next;
      });
      const msg = err instanceof Error ? err.message : '';
      const key = nodeCommandErrorKey(msg);
      toast.error(key ? t(key, { name: agent.name }) : t('connect.nodeCommandFailed'));
    }
  };


  return { toggling, toggleAgent };
}
