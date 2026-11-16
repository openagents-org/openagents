'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ActionLock {
  /** Some action in the skill dialog is in flight. */
  busy: boolean;
  /** Run one action while holding the lock; every action button reads `busy`. */
  run: (action: () => Promise<void>) => Promise<void>;
}

const ActionLockContext = createContext<ActionLock>({ busy: false, run: (action) => action() });

/**
 * One lock for everything the skill dialog can do — publish, unlist, fork,
 * yank, upload a version. They all refresh the same listing, so two in flight
 * at once race and the dialog can close on a stale copy.
 */
export function SkillActionLockProvider({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, []);
  const value = useMemo(() => ({ busy, run }), [busy, run]);
  return <ActionLockContext.Provider value={value}>{children}</ActionLockContext.Provider>;
}

export const useSkillActionLock = () => useContext(ActionLockContext);
