'use client';

import { useEffect } from 'react';
import { desktopHost } from '@/lib/desktop-host';
import { useWorkspace } from '@/lib/workspace-context';

/** Which first-run step the sidebar should point at, if any. */
export type SetupStep = 'device' | 'agent' | null;

export function useFirstDeviceGuide(): SetupStep {
  const { workspace, agents, refreshWorkspace } = useWorkspace();
  const hasAgent = agents.some(agent => !agent.builtin);
  const needsDevice = workspace?.needsFirstDevice === true && !hasAgent;
  // Signed in from the desktop app, the next step is connecting an agent.
  const step: SetupStep = needsDevice ? 'device' : !hasAgent && desktopHost() ? 'agent' : null;

  useEffect(() => {
    if (!needsDevice) return;
    // A device may pair from another tab before it has any agents to discover.
    const refresh = () => { if (document.visibilityState === 'visible') void refreshWorkspace(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [needsDevice, workspace?.workspaceId, refreshWorkspace]);

  return step;
}
