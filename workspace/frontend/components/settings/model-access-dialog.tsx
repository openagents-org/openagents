'use client';

/**
 * Add-model-access dialog: provider → API key (→ custom URL) with a live
 * check before saving. Used by the Model access settings page and by the
 * agent-config form ("Add new model access…").
 */

import { useState } from 'react';
import { CheckCircle2, Loader2, Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { workspaceApi } from '@/lib/api';
import type { CloudAgentProvider, ModelAccessEntry } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function AddModelAccessDialog({
  providers,
  createdBy,
  onClose,
  onSaved,
}: {
  providers: CloudAgentProvider[];
  createdBy?: string;
  onClose: () => void;
  onSaved: (entry: ModelAccessEntry) => void;
}) {
  const t = useT();
  const [provider, setProvider] = useState('');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'fail'; detail?: string }>({ state: 'idle' });

  const options = providers.filter((p) => !['openagents', 'manus', 'perplexity', 'custom'].includes(p.name));
  const canSubmit = provider && apiKey.trim() && (provider !== 'custom' || baseUrl.trim());

  const verify = async () => {
    if (!canSubmit) return;
    setCheck({ state: 'checking' });
    try {
      const r = await workspaceApi.modelProbe({
        provider,
        apiKey: apiKey.trim(),
        ...(provider === 'custom' ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (r.keyOk === false) setCheck({ state: 'fail', detail: r.error || t('connect.byokKeyInvalid') });
      else setCheck({ state: 'ok', detail: t('admin.modelAccessKeyOk', { count: (r.models || []).length }) });
    } catch (err) {
      setCheck({ state: 'fail', detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const save = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const entry = await workspaceApi.createModelAccess({
        provider,
        apiKey: apiKey.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(createdBy ? { createdBy } : {}),
      });
      toast.success(t('admin.modelAccessSaved'));
      onSaved(entry);
    } catch {
      toast.error(t('admin.modelAccessSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-4 rounded-2xl border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-semibold">{t('admin.modelAccessAdd')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.modelAccessAddBody')}</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">{t('admin.modelAccessProvider')}</Label>
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value); setCheck({ state: 'idle' }); }}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{t('admin.modelAccessPickProvider')}</option>
            {options.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
            <option value="custom">{t('connect.byokProviderCustom')}</option>
          </select>
        </div>

        {provider === 'custom' && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('admin.modelAccessBaseUrl')}</Label>
            <Input
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setCheck({ state: 'idle' }); }}
              placeholder={t('connect.byokBaseUrlPlaceholder')}
              className="h-10 font-mono text-sm"
            />
          </div>
        )}

        {provider && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('admin.modelAccessKey')}</Label>
              <Input
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setCheck({ state: 'idle' }); }}
                type="password"
                autoComplete="off"
                placeholder={t('connect.byokApiKeyPlaceholder')}
                className="h-10 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('admin.modelAccessLabel')}</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={options.find((p) => p.name === provider)?.label || provider}
                className="h-10 text-sm"
              />
            </div>

            <div className="flex items-start gap-2">
              <Button size="sm" variant="outline" onClick={verify} disabled={!canSubmit || check.state === 'checking'} className="shrink-0">
                {check.state === 'checking'
                  ? (<><Loader2 className="size-3.5 mr-1.5 animate-spin" />{t('connect.byokTesting')}</>)
                  : (<><Zap className="size-3.5 mr-1.5" />{t('admin.modelAccessVerify')}</>)}
              </Button>
              {check.state === 'ok' && (
                <span className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />{check.detail}
                </span>
              )}
              {check.state === 'fail' && (
                <span className="pt-1.5 text-[11px] text-red-600 dark:text-red-400">{check.detail}</span>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('connect.nodeCancel')}</Button>
          <Button
            onClick={save}
            disabled={!canSubmit || saving}
            className={cn(check.state === 'fail' && 'opacity-80')}
          >
            {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Plus className="size-4 mr-1.5" />}
            {t('admin.modelAccessSave')}
          </Button>
        </div>
      </div>
    </div>
  );
}
