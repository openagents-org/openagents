'use client';

import { useEffect, useState } from 'react';

/**
 * The launcher, as seen from inside the workspace.
 *
 * When the desktop build runs inside the launcher, its preload exposes this
 * bridge. On the web there is nothing there, and every hook below falls back
 * to the app's own behaviour — which is why the same components run in both
 * places without knowing the difference.
 *
 * Only two settings cross: dark or light, and which language. They are one
 * window, so those cannot disagree. Everything else — the accent colour, the
 * launcher's skin, its UI scale — stays on its own side of the line: this app
 * has its own design language, and repainting it in the host's would mean
 * editing its design tokens.
 */

export interface HostAppearance {
  theme: string;
  locale: string;
}

interface HostBridge {
  appearance: HostAppearance;
  setTheme: (theme: string) => void;
  setLocale: (locale: string) => void;
  onAppearance: (cb: (next: HostAppearance) => void) => () => void;
}

function bridge(): HostBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __oaHost__?: HostBridge }).__oaHost__ ?? null;
}

/** Whether this app is running inside the desktop launcher. */
export function isHosted(): boolean {
  return bridge() !== null;
}

/** What the host wants right now, or null when there is no host. */
export function hostAppearance(): HostAppearance | null {
  return bridge()?.appearance ?? null;
}

/** Tell the host the app changed one of the shared settings. */
export function reportTheme(theme: string): void {
  bridge()?.setTheme(theme);
}

export function reportLocale(locale: string): void {
  bridge()?.setLocale(locale);
}

/**
 * The host's appearance, kept current.
 *
 * Returns null off the desktop, so callers can tell "no host" from "host says
 * system" — the first means leave everything alone, the second is a value.
 */
export function useHostAppearance(): HostAppearance | null {
  const [appearance, setAppearance] = useState<HostAppearance | null>(hostAppearance);

  useEffect(() => {
    const host = bridge();
    if (!host) return;
    return host.onAppearance(setAppearance);
  }, []);

  return appearance;
}
