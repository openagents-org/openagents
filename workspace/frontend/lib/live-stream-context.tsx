'use client';

import { createContext, useContext } from 'react';
import type { LiveState, LiveStream } from './live-stream';

/** The tab's workspace-level live stream, when the workspace enabled it. */
export interface LiveStreamValue {
  stream: LiveStream | null;
  state: LiveState;
}

export const LiveStreamContext = createContext<LiveStreamValue>({ stream: null, state: 'stopped' });

export function useLiveStream(): LiveStreamValue {
  return useContext(LiveStreamContext);
}
