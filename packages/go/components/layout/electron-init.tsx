'use client';

import { useEffect, useState } from 'react';

export interface WorkspaceHistoryEntry {
  workspaceId: string;
  workspaceToken: string;
  endpoint?: string;
  name: string;
  lastUsed: number;
}

export interface WorkspaceSettings {
  workspaceId: string;
  workspaceToken: string;
  workspaceName?: string;
  workspaceEndpoint?: string;
  workspaceHistory: WorkspaceHistoryEntry[];
}

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      isElectron: boolean;
      openExternal: (url: string) => Promise<void>;
      settings: {
        load: () => Promise<WorkspaceSettings>;
        save: (settings: Partial<WorkspaceSettings>) => Promise<{ ok: boolean }>;
      };
    };
  }
}

function useIsElectron() {
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => {
    setIsElectron(!!window.electronAPI);
  }, []);
  return isElectron;
}

/**
 * Adds the 'electron' class to <body> when running inside Electron.
 * This enables the 28px top padding for the drag region.
 */
export function ElectronInit() {
  const isElectron = useIsElectron();

  useEffect(() => {
    if (isElectron) {
      document.body.classList.add('electron');
    }
  }, [isElectron]);

  return null;
}

/**
 * Fixed transparent drag bar at the top of the window.
 * Allows the user to move the window by dragging the top 28px.
 * Only renders inside Electron.
 */
export function ElectronDragBar() {
  const isElectron = useIsElectron();

  if (!isElectron) return null;

  return (
    <div
      className="app-drag-region"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 28,
        zIndex: 1000,
        backgroundColor: 'transparent',
      }}
    />
  );
}
