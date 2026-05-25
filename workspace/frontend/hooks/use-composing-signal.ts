import { useCallback, useEffect, useRef } from 'react';
import { workspaceApi } from '@/lib/api';

const SIGNAL_INTERVAL_MS = 10_000;
const AFK_TIMEOUT_MS = 5 * 60 * 1000;

export function useComposingSignal(channelName: string | null) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef(0);
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    activeRef.current = false;
  }, []);

  const sendSignal = useCallback(() => {
    if (!channelName) return;
    if (Date.now() - lastActivityRef.current > AFK_TIMEOUT_MS) {
      stop();
      return;
    }
    workspaceApi.sendComposing(channelName);
  }, [channelName, stop]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    lastActivityRef.current = Date.now();
    sendSignal();
    intervalRef.current = setInterval(sendSignal, SIGNAL_INTERVAL_MS);
  }, [sendSignal]);

  const notifyTyping = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!activeRef.current) start();
  }, [start]);

  useEffect(() => {
    return stop;
  }, [channelName, stop]);

  return { notifyFocus: start, notifyBlur: stop, notifyTyping };
}
