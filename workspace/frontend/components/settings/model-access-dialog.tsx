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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  // Credential-only kinds outside the provider catalog; both need a base URL.
  const isCustomKind = provider === 'custom' || provider === 'custom-anthropic';
  const canSubmit = provider && apiKey.trim() && (!isCustomKind || baseUrl.trim());

  const verify = async () => {
    if (!canSubmit) return;
    setCheck({ state: 'checking' });
    try {
      const r = await workspaceApi.modelProbe({
        provider,
        apiKey: apiKey.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
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
          <Select
            value={provider || undefined}
            onValueChange={(v) => { setProvider(v); setCheck({ state: 'idle' }); }}
          >
            <SelectTrigger className="h-10 w-full">
              {/* Nothing chosen yet is exactly what a placeholder is for, so
                  unlike the other pickers this one needs no stand-in value. */}
              <SelectValue placeholder={t('admin.modelAccessPickProvider')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((p) => (
                <SelectItem key={p.name} value={p.name}>{p.label}</SelectItem>
              ))}
              <SelectItem value="custom">{t('connect.byokProviderCustom')}</SelectItem>
              <SelectItem value="custom-anthropic">
                {t('connect.byokProviderCustomAnthropic')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isCustomKind && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('admin.modelAccessBaseUrl')}</Label>
            <Input
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setCheck({ state: 'idle' }); }}
              placeholder={t('connect.byokBaseUrlPlaceholder')}
              className="h-10 font-mono text-sm"
            />
            {provider === 'custom-anthropic' && (
              <p className="text-[11px] text-muted-foreground">{t('admin.modelAccessAnthropicCompatHint')}</p>
            )}
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
