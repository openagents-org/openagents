'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import type { NodeRuntime, WorkspaceNode } from '@/lib/types';
import { DETECT_DEADLINE_MS, type AgentSetupApi } from './agent-setup-types';

/** The device's runtime list and the "Detecting…" state around it. */
export function useRuntimeDetection(node: WorkspaceNode, api: AgentSetupApi, onChanged: () => void) {
  const t = useT();
  // Detection is "in progress" until the node reports its runtime list — either
  // on first open (nothing reported yet) or after a Re-detect, until fresh data
  // arrives on the next heartbeat.
  const hasRuntimes = (node.runtimes || []).length > 0;
  const [detecting, setDetecting] = useState(!hasRuntimes);
  const [detectTimedOut, setDetectTimedOut] = useState(false);

  const runtimeByType = useMemo(() => {
    const m: Record<string, NodeRuntime> = {};
    for (const r of node.runtimes || []) m[r.type] = r;
    return m;
  }, [node.runtimes]);

  // Clear "detecting" as soon as the runtime snapshot arrives or changes.
  const runtimesSig = (node.runtimes || []).map((r) => `${r.type}:${r.installed}:${r.ready}:${r.signedIn}:${r.auth?.mode}:${r.probe?.at ?? ''}`).join('|');
  const prevSigRef = useRef(runtimesSig);
  useEffect(() => {
    if (runtimesSig !== prevSigRef.current) {
      prevSigRef.current = runtimesSig;
      setDetecting(false);
      setDetectTimedOut(false);
    }
  }, [runtimesSig]);

  // Detection always ends. A device that is offline, or whose list never
  // arrives, used to leave "Detecting…" up for good; after the deadline it
  // says so and offers Re-detect. With nothing reported, the cards stay
  // "unknown", never "not installed".
  const hasRuntimesRef = useRef(hasRuntimes);
  hasRuntimesRef.current = hasRuntimes;
  useEffect(() => {
    if (!detecting) return;
    const deadline = setTimeout(() => {
      setDetecting(false);
      setDetectTimedOut(!hasRuntimesRef.current);
    }, DETECT_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [detecting]);

  const reDetect = async () => {
    setDetecting(true);
    setDetectTimedOut(false);
    try {
      await api.enqueueNodeCommand(node.nodeId, 'detect_runtimes', {});
      setTimeout(onChanged, 4000);
      // The detection deadline above stops the spinner if fresh data never arrives.
    } catch {
      toast.error(t('connect.nodeCommandFailed'));
      setDetecting(false);
    }
  };

  return { runtimeByType, detecting, detectTimedOut, reDetect };
}
