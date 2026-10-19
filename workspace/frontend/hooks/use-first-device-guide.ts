'use client';

import { useEffect } from 'react';
import { useWorkspace } from '@/lib/workspace-context';

export function useFirstDeviceGuide() {
  const { workspace, agents, refreshWorkspace } = useWorkspace();
  const needsDevice = workspace?.needsFirstDevice === true && !agents.some(agent => !agent.builtin);

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

  return needsDevice;
}
