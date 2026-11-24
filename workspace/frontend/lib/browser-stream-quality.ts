'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** Browser Fabric live-view presets: low = 1024×576 JPEG q40, high = 1280×720 q60. */
export type StreamQuality = 'high' | 'low';

const KEY = 'oa.browser.streamQuality';

/**
 * Set by surfaces too small to benefit from the sharp stream (the thread's
 * compact browser overlay): they always stream low, and offer no choice.
 */
export const ForcedStreamQuality = createContext<StreamQuality | null>(null);

function readPreference(): StreamQuality {
  try { return localStorage.getItem(KEY) === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}

/**
 * The live-view quality for this surface: forced by a small container, or the
 * person's own choice (high by default) on the full browser view.
 */
export function useStreamQuality(): { quality: StreamQuality; forced: boolean; setQuality: (quality: StreamQuality) => void } {
  const forced = useContext(ForcedStreamQuality);
  const [preference, setPreference] = useState<StreamQuality>('high');
  useEffect(() => {
    setPreference(readPreference());
    const onStorage = (event: StorageEvent) => { if (event.key === KEY) setPreference(readPreference()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setQuality = useCallback((quality: StreamQuality) => {
    setPreference(quality);
    try { localStorage.setItem(KEY, quality); } catch { /* private mode: this page only */ }
  }, []);
  return { quality: forced ?? preference, forced: forced !== null, setQuality };
}
