'use client';

import { Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AgentModelOptions } from './use-agent-model-options';

/** "Provider default", as a value a Select can hold. See NO_AGENT elsewhere. */
const DEFAULT_MODEL = '__default__';

/** Picking this in the list switches the field to a typed model id. */
const CUSTOM_MODEL = '__custom__';

const HINT = 'text-xs leading-relaxed text-muted-foreground';

function ModelCardHeader({ busy }: { busy?: boolean }) {
  const t = useT();
  return (
    <CardHeader className="flex items-center gap-1.5 px-0 pb-3 pt-0">
      <Cpu className="size-3 text-muted-foreground" />
      <span className="text-sm font-medium">{t('agents.fieldModel')}</span>
      {busy && <Spinner className="ml-auto size-3 text-muted-foreground" />}
    </CardHeader>
  );
}

/** The model a managed agent, or one someone shared, runs on. */
export function ReadOnlyModelCard({ model, managed }: { model: string; managed: boolean }) {
  const t = useT();
  return (
    <Card size="sm" className="gap-0 overflow-visible rounded-none border-b bg-transparent py-5 ring-0">
      <ModelCardHeader />
      <CardContent className="flex flex-col gap-2 px-0 py-0">
        <div className="font-mono text-xs">{model || '—'}</div>
        <p className={HINT}>{t(managed ? 'agents.modelManagedHint' : 'agents.ownerOnlyHint')}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Model — picker fed by the agent/provider catalog, by the list a signed-in
 * agent's CLI reports for its account, or by the endpoint's own list when the
 * catalog isn't for that endpoint; free-form ids stay selectable (prepended
 * when not listed).
 */
export function ModelCard({ m }: { m: AgentModelOptions }) {
  const t = useT();
  const { currentModel, savingModel, modelLoading, modelApplies, typeModel, pickerOptions, catalogFits, endpointHost, liveLoading, liveError, modelLoadError } = m;
  return (
    <Card size="sm" className="gap-0 overflow-visible rounded-none border-b bg-transparent py-5 ring-0">
      <ModelCardHeader busy={savingModel || modelLoading} />
      <CardContent className="flex flex-col gap-2 px-0 py-0">
        {modelLoading ? (
          <p className={HINT}>{t('agents.modelLoading')}</p>
        ) : !modelApplies ? (
          <>
            {/* Only the way back to the default is offered: a model
                saved here earlier is shown, and can be cleared. */}
            {currentModel && (
              <Select
                value={currentModel}
                onValueChange={(v) => m.handleModelChange(v === DEFAULT_MODEL ? '' : v)}
                disabled={savingModel}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup><SelectItem value={DEFAULT_MODEL}>{t('agents.modelDefault')}</SelectItem>
                  <SelectItem value={currentModel}>{currentModel}</SelectItem></SelectGroup>
                </SelectContent>
              </Select>
            )}
            <p className={HINT}>{t('agents.modelNotApplied')}</p>
          </>
        ) : typeModel ? (
          <>
            <Input
              aria-label={t('agents.fieldModel')}
              value={m.modelDraft}
              onChange={(e) => { m.setModelDraft(e.target.value); m.setManualEntry(true); }}
              onBlur={() => {
                const next = m.modelDraft.trim();
                if (next !== currentModel) void m.handleModelChange(next);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder={t('agents.modelCustomPlaceholder')}
              disabled={savingModel}
              className="h-9 font-mono text-sm"
            />
            {m.liveModels?.length ? (
              <Button
                type="button"
                onClick={() => { m.setManualEntry(false); m.setModelDraft(currentModel); }}
                variant="link" size="xs" className="h-auto self-start px-0 text-muted-foreground"
              >
                {t('agents.modelPickFromList')}
              </Button>
            ) : null}
          </>
        ) : (
          <Select
            value={currentModel || DEFAULT_MODEL}
            onValueChange={(v) => {
              if (v === CUSTOM_MODEL) { m.setManualEntry(true); return; }
              void m.handleModelChange(v === DEFAULT_MODEL ? '' : v);
            }}
            disabled={savingModel || (m.isCloud && !m.cloudConfig)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>{!m.isCloud && (
                <SelectItem value={DEFAULT_MODEL}>
                  {t('agents.modelDefault')}
                </SelectItem>
              )}
              {/* A model the agent is on but the list does not have
                  — a hand-edited config, or one the provider dropped.
                  Listing it is what keeps the picker from silently
                  showing something the agent is not running. */}
              {currentModel && !(pickerOptions || []).some((o) => o.id === currentModel) && (
                <SelectItem value={currentModel}>{currentModel}</SelectItem>
              )}
              {(pickerOptions || []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label || o.id}
                </SelectItem>
              ))}
              {!catalogFits && (
                <SelectItem value={CUSTOM_MODEL}>{t('agents.modelEnterCustom')}</SelectItem>
              )}</SelectGroup>
            </SelectContent>
          </Select>
        )}
        {modelApplies && !catalogFits && endpointHost && (
          <p className={HINT}>
            {liveLoading
              ? t('agents.modelLiveLoading', { host: endpointHost })
              : typeModel
                ? t('agents.modelCustomHint', { host: endpointHost })
                : t('agents.modelLiveHint', { host: endpointHost })}
          </p>
        )}
        {modelApplies && !typeModel && !modelLoading && catalogFits && m.accountModels?.length ? (
          <p className={HINT}>{t('agents.modelAccountHint')}</p>
        ) : null}
        {modelApplies && typeModel && !liveLoading && liveError && (
          <p className={cn(HINT, 'break-words')}>{t('agents.modelLiveFailed', { error: liveError })}</p>
        )}
        {modelLoadError && (
          <div className="flex flex-col gap-1.5">
            <p className={cn(HINT, 'break-words')}>{t('agents.modelLiveFailed', { error: modelLoadError })}</p>
            <Button
              type="button"
              onClick={m.reload}
              variant="link" size="xs" className="h-auto self-start px-0 text-muted-foreground"
            >
              {t('agents.modelRetry')}
            </Button>
          </div>
        )}
        {!m.isCloud && modelApplies && (
          <p className={HINT}>{t('agents.modelHint')}</p>
        )}
      </CardContent>
    </Card>
  );
}
