'use client';

import { useEffect, useState } from 'react';
import { desktopHost } from '@/lib/desktop-host';

/**
 * This computer's node in the given workspace, so a device list can mark it.
 * `null` until known, outside the desktop app, or when this computer has not
 * joined that workspace — joining workspace A says nothing about workspace B.
 */
export function useLocalNodeId(workspaceId: string | undefined, refreshKey?: unknown): string | null {
  const [nodeId, setNodeId] = useState<string | null>(null);
  useEffect(() => {
    setNodeId(null);
    const host = desktopHost();
    if (!workspaceId || !host?.getComputerStatus) return;
    let active = true;
    host.getComputerStatus(workspaceId).then((info) => {
      if (active) setNodeId(info.nodeId);
    }).catch(() => {});
    return () => { active = false; };
  }, [workspaceId, refreshKey]);
  return nodeId;
}
