'use client';
import React from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectGroup, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { CUSTOM_MODEL } from './agent-setup-types';
import type { AgentSetupForm } from './use-agent-setup-form';

/** The models a picked access can use, and a live check of the one picked. */
export function ByokModelPicker({ form }: { form: AgentSetupForm }) {
  const t = useT();
  const { byokState: b, model, setModel, modelError, modelFieldRef } = form;
  return (
    <>
      {b.loading && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />{t('connect.byokLoadingModels')}
        </p>
      )}
      {b.keyError && (
        <p className="text-xs text-destructive">{b.keyError}</p>
      )}

      {/* Model — the ones this key can actually use. Marked
          required up here: the only other word of it was the
          footer error, out of sight below a tall form. */}
      {b.models && (
        <Field ref={modelFieldRef} data-invalid={!!modelError || undefined}>
          <FieldLabel>
            {t('connect.byokModelLabel')}{' '}
            <span className="text-destructive">* {t('connect.requiredMark')}</span>
          </FieldLabel>
          <Select
            value={b.customModel ? CUSTOM_MODEL : model || undefined}
            onValueChange={(v) => {
              if (v === CUSTOM_MODEL) { b.setCustomModel(true); setModel(''); }
              else { b.setCustomModel(false); setModel(v); }
              b.setTest({ state: 'idle' });
            }}
          >
            <SelectTrigger aria-invalid={!!modelError} className="h-10 w-full">
              <SelectValue placeholder={t('connect.byokChooseModel')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>{b.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
              ))}
              <SelectItem value={CUSTOM_MODEL}>
                {t('connect.byokCustomModel')}
              </SelectItem></SelectGroup>
            </SelectContent>
          </Select>
          {b.customModel && (
            <Input
              value={model}
              aria-invalid={!!modelError}
              onChange={(e) => { setModel(e.target.value); b.setTest({ state: 'idle' }); }}
              placeholder="claude-sonnet-4-6"
              className="h-10 font-mono text-sm"
            />
          )}
          {modelError && <FieldError data-testid="agent-setup-model-error">{modelError}</FieldError>}
          <FieldDescription>
            {!b.models.length
              ? t('connect.byokModelsUnavailable')
              : b.modelsSource === 'live'
                ? t('connect.byokModelsLive', { count: b.models.length })
                : t('connect.byokModelsCatalog')}
          </FieldDescription>
          {b.probeError && (
            <FieldDescription className="break-words">{b.probeError}</FieldDescription>
          )}
        </Field>
      )}

      {/* Live validation before adding */}
      <div className="flex items-start gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={b.runTest}
          disabled={!model.trim() || b.test.state === 'testing'}
          className="shrink-0"
        >
          {b.test.state === 'testing'
            ? (<><Spinner data-icon="inline-start" />{t('connect.byokTesting')}</>)
            : (<><Zap data-icon="inline-start" />{t('connect.byokTest')}</>)}
        </Button>
        {b.test.state === 'ok' && (
          <span className="pt-1.5 text-xs leading-relaxed text-success">
            {t('connect.byokTestOk', { model: model.trim(), ms: b.test.ms ?? 0 })}
          </span>
        )}
        {b.test.state === 'fail' && (
          <span className="pt-1.5 text-xs leading-relaxed text-destructive">
            {t('connect.byokTestFail')}{b.test.error ? ` — ${b.test.error}` : ''}
          </span>
        )}
      </div>
    </>
  );
}
