'use client';
import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

/** Media elements cannot send Authorization headers. Fetch with the viewer's
 * identity and show a local blob, never a bearer credential in a public URL. */
export function useFileObjectUrl(fileId?: string) {
  const { idToken } = useOpenAgentsAuth();
  const key = `${fileId}:${idToken}`;
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>({ key: '' });
  useEffect(() => {
    if (!fileId) return;
    const abort = new AbortController();
    let url: string | undefined;
    void workspaceApi.fetchFile(fileId, abort.signal).then(response => response.blob()).then(blob => {
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(blob); setState({ key, url });
    }).catch(() => { if (!abort.signal.aborted) setState({ key, failed: true }); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [fileId, key]);
  return state.key === key ? state : { key };
}
