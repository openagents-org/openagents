'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** After this long a create still in flight says it is taking a while. */
export const CREATE_SLOW_MS = 10_000;
/** After this long it stops promising an outcome and offers to check the list. */
export const CREATE_UNCONFIRMED_MS = 30_000;

export type CreateWorkspacePhase =
  | 'idle'
  | 'creating'
  | 'slow'
  | 'unconfirmed'
  /** Created; navigation into it has been asked for. */
  | 'opening'
  | 'failed';

/**
 * Creating a workspace and opening it are two steps that fail apart. A create
 * that is slow, lost, or done but never navigated used to leave one spinner
 * forever. Each stage is now its own phase, and only `submit` ever calls
 * `create` — reopening a created workspace, checking the list, or waiting
 * longer never sends a second request, since a name alone cannot tell this
 * create's workspace from another of the same name.
 */
export function useCreateWorkspace<W extends { slug: string }>({ create, open }: {
  create: (name: string) => Promise<W>;
  open: (workspace: W) => void;
}) {
  const [phase, setPhase] = useState<CreateWorkspacePhase>('idle');
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<W | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimers(); };
  }, []);

  const submit = useCallback(async (name: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setCreated(null);
    setPhase('creating');
    clearTimers();
    timers.current = [
      setTimeout(() => setPhase((p) => (p === 'creating' ? 'slow' : p)), CREATE_SLOW_MS),
      setTimeout(() => setPhase((p) => (p === 'creating' || p === 'slow' ? 'unconfirmed' : p)), CREATE_UNCONFIRMED_MS),
    ];
    try {
      const workspace = await create(name);
      clearTimers();
      // Left the page meanwhile: the workspace exists and the list shows it,
      // but nobody asked to be carried into it from somewhere else.
      if (!mounted.current) return;
      setCreated(workspace);
      setPhase('opening');
      open(workspace);
    } catch (err) {
      clearTimers();
      if (!mounted.current) return;
      setError(err);
      setPhase('failed');
    } finally {
      inFlight.current = false;
    }
  }, [create, open]);

  /** Navigate into the workspace this create returned, without creating again. */
  const reopen = useCallback(() => {
    if (created) open(created);
  }, [created, open]);

  /** Back to an editable form. Does not stop a create already sent. */
  const reset = useCallback(() => {
    if (inFlight.current) return;
    setPhase('idle');
    setError(null);
  }, []);

  const pending = phase === 'creating' || phase === 'slow' || phase === 'unconfirmed' || phase === 'opening';
  return { phase, error, created, submit, reopen, reset, pending };
}
