'use client';

import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { CloudAgentModel } from '@/lib/types';

const EMPTY_MODELS: CloudAgentModel[] = [];

/** Load the live catalogue after key entry; ignore results for replaced keys. */
export function useTokenPayModels(enabled: boolean, apiKey: string) {
  const key = apiKey.trim();
  const [result, setResult] = useState<{
    key: string;
    models: CloudAgentModel[];
    error?: string;
  }>({ key: '', models: EMPTY_MODELS });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !key) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await workspaceApi.modelProbe({ provider: 'tokenpay', apiKey: key });
        if (cancelled) return;
        if (response.keyOk !== true || response.error) {
          setResult({ key, models: EMPTY_MODELS, error: response.error || 'Unable to load TokenDance models' });
        } else {
          setResult({ key, models: response.models || EMPTY_MODELS });
        }
      } catch (error) {
        if (!cancelled) setResult({ key, models: EMPTY_MODELS, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, key]);

  const current = enabled && !!key && result.key === key;
  return {
    models: current ? result.models : EMPTY_MODELS,
    error: current ? result.error : undefined,
    loading: enabled && !!key && (loading || !current),
  };
}
