import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';

function controlError(err: unknown): string {
  if (!(err instanceof Error)) return 'Could not change browser control.';
  const raw = err.message.replace(/^API \d+: /, '');
  try { const body = JSON.parse(raw); return body.detail || body.message || raw; } catch { return raw; }
}

/** A bounded lease keeps agent actions paused while this view is interactive. */
export function useBrowserControl(tabId?: string) {
  const [controlling, setControlling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frameRevision, setFrameRevision] = useState(0);
  const lease = useRef<{ id: string; token: string } | null>(null);
  const generation = useRef(0);
  const queue = useRef(Promise.resolve());
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = async () => {
    const current = lease.current;
    lease.current = null;
    setControlling(false);
    if (deadline.current) clearTimeout(deadline.current);
    if (current) await workspaceApi.controlBrowserTab(current.id, current.token, 'release');
  };
  const armDeadline = () => {
    if (deadline.current) clearTimeout(deadline.current);
    deadline.current = setTimeout(() => { void release().catch(() => {}); }, 55000);
  };

  useEffect(() => {
    generation.current++;
    setBusy(false);
    setControlling(false);
    return () => {
      generation.current++;
      void release().catch(() => {});
    };
  }, [tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!controlling) return;
    let renewing = false;
    const interval = setInterval(async () => {
      const current = lease.current;
      if (!current || renewing) return;
      renewing = true;
      try {
        await workspaceApi.controlBrowserTab(current.id, current.token, 'renew');
        if (lease.current === current) armDeadline();
      } catch {
        if (lease.current === current) void release().catch(() => {});
      } finally { renewing = false; }
    }, 20000);
    return () => clearInterval(interval);
  }, [controlling]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (!tabId || busy) return;
    setBusy(true);
    const version = generation.current;
    try {
      if (lease.current) await release();
      else {
        const current = { id: tabId, token: crypto.randomUUID() };
        await workspaceApi.controlBrowserTab(current.id, current.token, 'claim');
        if (generation.current !== version) {
          await workspaceApi.controlBrowserTab(current.id, current.token, 'release');
          return;
        }
        lease.current = current;
        armDeadline();
        setControlling(true);
      }
    } catch (err) {
      if (generation.current === version) toast.error(controlError(err));
    } finally {
      if (generation.current === version) setBusy(false);
    }
  };

  const input = (command: Omit<Parameters<typeof workspaceApi.sendBrowserInput>[1], 'token'>) => {
    const current = lease.current;
    if (!current) return;
    // Preserve gesture order even when the browser or network is slow.
    queue.current = queue.current.then(async () => {
      if (lease.current !== current) return;
      try {
        await workspaceApi.sendBrowserInput(current.id, { ...command, token: current.token });
        if (lease.current === current) setFrameRevision((v) => v + 1);
      } catch (err) {
        if (lease.current !== current) return;
        toast.error(controlError(err));
        await release().catch(() => {});
      }
    });
  };
  return { controlling, busy, toggle, input, frameRevision };
}
