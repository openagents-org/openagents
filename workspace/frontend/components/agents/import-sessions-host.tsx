'use client';

/**
 * One place that opens "Import past sessions", from wherever it is offered:
 * the notice when an agent joins (also during onboarding, when the page that
 * added the agent is already gone), an agent's row on the Devices page, and
 * the desktop app's own Add agent page (which opens the workspace with
 * `?import=<agent>`). Mounted once in the app shell.
 *
 *   openImportSessions('my-codex')   // from anywhere
 */

import { useCallback, useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceNode } from '@/lib/types';
import { ImportSessionsDialog, isImportableType, type ImportableType } from './import-sessions-dialog';

export const OPEN_IMPORT_SESSIONS = 'oa-open-import-sessions';

/** Open the picker for `agent`'s tool, on the device it runs on. */
export function openImportSessions(agent: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_IMPORT_SESSIONS, { detail: { agent } }));
}

/** The agent `?import=` names, in the page URL or (desktop app) its hash route. */
export function importRequestedInUrl(href: string): string | null {
  try {
    const url = new URL(href);
    const fromSearch = url.searchParams.get('import');
    if (fromSearch) return fromSearch;
    const at = url.hash.indexOf('?');
    return at >= 0 ? new URLSearchParams(url.hash.slice(at + 1)).get('import') : null;
  } catch { return null; }
}

/** Drop `import=` from the address once handled, so a reload doesn't reopen it. */
function forgetImportParam() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('import')) url.searchParams.delete('import');
    const at = url.hash.indexOf('?');
    if (at >= 0) {
      const q = new URLSearchParams(url.hash.slice(at + 1));
      if (q.has('import')) { q.delete('import'); url.hash = url.hash.slice(0, at) + (q.size ? `?${q}` : ''); }
    }
    window.history.replaceState(window.history.state, '', url.toString());
  } catch { /* keep the address as it is */ }
}

export function ImportSessionsHost() {
  const [target, setTarget] = useState<{ node: WorkspaceNode; type: ImportableType; agent: string } | null>(null);

  // A just-added agent may take a few seconds to appear on its device.
  const open = useCallback(async (agent: string) => {
    for (let i = 0; i < 10; i++) {
      const nodes = await workspaceApi.listNodes().catch((): WorkspaceNode[] => []);
      const node = nodes.find((n) => (n.agents || []).some((a) => a.name === agent));
      const type = node?.agents.find((a) => a.name === agent)?.type;
      if (node && isImportableType(type)) { setTarget({ node, type, agent }); return; }
      if (node) return; // on a device, but not a tool whose sessions can be imported
      await new Promise((r) => setTimeout(r, 3000));
    }
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const agent = (e as CustomEvent<{ agent?: string }>).detail?.agent;
      if (agent) void open(agent);
    };
    window.addEventListener(OPEN_IMPORT_SESSIONS, onOpen);
    const requested = importRequestedInUrl(window.location.href);
    if (requested) { forgetImportParam(); void open(requested); }
    return () => window.removeEventListener(OPEN_IMPORT_SESSIONS, onOpen);
  }, [open]);

  if (!target) return null;
  return (
    <ImportSessionsDialog open onOpenChange={(v) => { if (!v) setTarget(null); }}
      node={target.node} type={target.type} agentName={target.agent} />
  );
}
