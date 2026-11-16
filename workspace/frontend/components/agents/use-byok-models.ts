'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { ModelAccessEntry } from '@/lib/types';
import type { AgentDraft, AgentSetupApi } from './agent-setup-types';

type ByokModel = { id: string; label: string };
export type ByokTest = { state: 'idle' | 'testing' | 'ok' | 'fail'; ms?: number; error?: string };

/**
 * Bring-your-own-provider agents: the workspace's saved model accesses, the
 * one picked, the models that key can use and its live check.
 */
export function useByokModels({ api, byok, protocol, draft, model, setModel }: {
  api: AgentSetupApi;
  byok: boolean;
  protocol: string;
  draft?: AgentDraft;
  model: string;
  setModel: (model: string) => void;
}) {
  const t = useT();
  const probeProtocol = protocol === 'anthropic' ? 'anthropic' : 'openai';
  const [accesses, setAccesses] = useState<ModelAccessEntry[] | null>(null);
  // Anthropic-protocol agents (Claude family) can only use Anthropic keys or
  // Anthropic-compatible relays — filter the saved accesses accordingly.
  const accessOptions = (accesses || []).filter((a) =>
    protocol === 'anthropic'
      ? ['anthropic', 'custom-anthropic', 'tokenpay'].includes(a.provider)
      : a.provider !== 'custom-anthropic',
  );
  const [accessId, setAccessId] = useState(draft?.modelAccessId ?? '');
  const [customModel, setCustomModel] = useState(false);
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const [models, setModels] = useState<ByokModel[] | null>(null);
  const [modelsSource, setModelsSource] = useState<'live' | 'catalog' | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  // Why the models listing failed (DNS, timeout, wrong URL, 5xx) when the key
  // itself wasn't rejected — shown under the manual-entry hint.
  const [probeError, setProbeError] = useState<string | null>(null);
  const [test, setTest] = useState<ByokTest>({ state: 'idle' });

  useEffect(() => {
    if (!byok || accesses !== null) return;
    api.listModelAccess().then(setAccesses).catch(() => setAccesses([]));
  }, [byok, accesses]);

  const resetChecks = () => {
    setModels(null); setModelsSource(null); setKeyError(null); setProbeError(null); setTest({ state: 'idle' });
  };

  const loadModels = async (id: string): Promise<ByokModel[] | null> => {
    if (!id) return null;
    setLoading(true); setKeyError(null); setProbeError(null); setTest({ state: 'idle' });
    try {
      const r = await api.probeModelAccess(id, undefined, probeProtocol);
      // Only a rejected key blocks. Many relays/gateways don't implement a
      // models listing at all — they still work, so fall through to manual
      // model entry instead of hiding the model field.
      if (r.keyOk === false) {
        setKeyError(r.error || t('connect.byokKeyInvalid'));
        setModels(null);
        return null;
      }
      const listed = (r.models || [])
        .filter((m) => m.category !== 'image' && m.category !== 'audio')
        .map((m) => ({ id: m.id, label: m.label }))
        // Providers return /models in arbitrary order — sort by name so the
        // dropdown is scannable. numeric:true keeps version numbers sane
        // (gpt-4 < gpt-5.1 < gpt-5.6, qwen-1.8b < qwen3.5).
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
      setModels(listed);
      setModelsSource(r.source || 'live');
      setProbeError(!listed.length && r.error ? r.error : null);
      if (!listed.length) setCustomModel(true);
      return listed;
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  };

  // A retry reopens on the access it was submitted with. Load that key's
  // models once the agent's protocol is known, keeping the model picked then.
  const draftAccessLoaded = useRef(false);
  useEffect(() => {
    if (!byok || !draft?.modelAccessId || draftAccessLoaded.current) return;
    draftAccessLoaded.current = true;
    void loadModels(draft.modelAccessId).then((listed) => {
      if (draft.model && listed?.length && !listed.some((m) => m.id === draft.model)) setCustomModel(true);
    });
  }, [byok]);

  const pickAccess = (id: string) => {
    setAccessId(id);
    setModel('');
    setCustomModel(false);
    resetChecks();
    if (id) loadModels(id);
  };

  const runTest = async () => {
    if (!accessId || !model.trim()) return;
    setTest({ state: 'testing' });
    try {
      const r = await api.probeModelAccess(accessId, model.trim(), probeProtocol);
      if (r.ok) setTest({ state: 'ok', ms: r.latencyMs });
      else setTest({ state: 'fail', error: r.error });
    } catch (err) {
      setTest({ state: 'fail', error: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    accesses, setAccesses, accessOptions, accessId, setAccessId,
    customModel, setCustomModel, showAccessDialog, setShowAccessDialog,
    models, modelsSource, loading, keyError, probeError, test, setTest,
    resetChecks, pickAccess, runTest,
  };
}

export type ByokState = ReturnType<typeof useByokModels>;
