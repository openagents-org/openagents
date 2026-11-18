'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy, KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { CloudAgentConfig } from '@/lib/types';

export interface InfoItem { icon: ReactNode; label: string; value: string; copyable?: boolean }

/** Where the agent runs and how to address it. */
export function ConnectionDetailsCard({ items }: { items: InfoItem[] }) {
  const t = useT();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <details className="group/connection border-b py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {t('agents.connectionDetails')}<ChevronDown className="size-4 text-muted-foreground transition-transform group-open/connection:rotate-180" />
      </summary>
      <dl className="mt-4 flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">{item.icon}{item.label}</dt>
            <dd className="flex min-w-0 items-start justify-between gap-2">
              <span className="min-w-0 break-all font-mono text-xs leading-relaxed" title={item.value}>{item.value}</span>
              {item.copyable && <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" title={t('agents.copyField', { field: item.label })} aria-label={t('agents.copyField', { field: item.label })} onClick={() => copyToClipboard(item.value)}>{isCopied ? <Check /> : <Copy />}</Button>}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** A cloud agent's key, replaceable inline, and its system prompt. */
export function CloudConfigCard({ agentName, config, onUpdated }: { agentName: string; config: CloudAgentConfig; onUpdated: () => void }) {
  const t = useT();
  const [editingKey, setEditingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  useEffect(() => { setEditingKey(false); setNewApiKey(''); }, [agentName]);

  const handleUpdateApiKey = useCallback(async () => {
    if (!newApiKey) return;
    setSavingKey(true);
    try {
      await workspaceApi.updateCloudAgent(agentName, { apiKey: newApiKey });
      toast.success(t('agents.apiKeyUpdated'));
      setEditingKey(false);
      setNewApiKey('');
      onUpdated();
    } catch {
      toast.error(t('agents.apiKeyFailed'));
    } finally {
      setSavingKey(false);
    }
  }, [agentName, newApiKey, onUpdated]);

  return (
    <Card size="sm" className="gap-0 overflow-visible rounded-none border-b bg-transparent py-5 ring-0">
      <CardHeader className="px-0 pb-3 pt-0">
        <span className="text-xs font-medium">{t('agents.cloudConfiguration')}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 py-0">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('agents.fieldApiKey')}</span>
            {!editingKey && (
              <Button onClick={() => setEditingKey(true)} variant="link" size="xs" className="h-auto px-0 text-muted-foreground">
                <KeyRound data-icon="inline-start" />
                {t('agents.apiKeyUpdate')}
              </Button>
            )}
          </div>
          {editingKey ? (
            <div className="flex gap-1.5">
              <Input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder={t('agents.apiKeyPlaceholder')}
                className="h-7 min-w-0 flex-1 font-mono text-xs"
                autoFocus
              />
              <Button onClick={handleUpdateApiKey} disabled={savingKey || !newApiKey} size="xs">
                {savingKey ? <Spinner /> : t('common.save')}
              </Button>
              <Button onClick={() => { setEditingKey(false); setNewApiKey(''); }} variant="outline" size="xs">
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">{config.apiKeyMasked}</span>
          )}
        </div>

        {/* System prompt (if set) */}
        {config.systemPrompt && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('agents.systemPrompt')}</span>
            <p className="line-clamp-3 text-xs whitespace-pre-wrap text-foreground">{config.systemPrompt}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Remove this agent from the workspace (node/local agents; cloud agents use
 *  the footer Remove button). */
export function DangerZoneCard({ onRemove }: { onRemove: () => void }) {
  const t = useT();
  return (
    <details className="group/remove pt-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
        {t('agents.dangerZone')}<ChevronDown className="size-4 transition-transform group-open/remove:rotate-180" />
      </summary>
      <div className="mt-4 flex flex-col items-start gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{t('agents.removeAgentHint')}</p>
        <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={onRemove}><Trash2 data-icon="inline-start" />{t('agents.remove')}</Button>
      </div>
    </details>
  );
}
