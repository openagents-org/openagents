'use client';
import React from 'react';
import { Folder } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { defaultAgentNameBase } from '@/lib/agent-name';
import type { AgentSetupProps } from './agent-setup-types';
import { FolderPicker } from './agent-setup-folder-picker';
import type { AgentSetupForm } from './use-agent-setup-form';

/** The label, editable where the host can rename. */
export function DisplayNameField({ form, placeholder }: { form: AgentSetupForm; placeholder: string }) {
  const t = useT();
  return (
    <Field>
      <FieldLabel>{t('connect.agentDisplayNameLabel')}</FieldLabel>
      <Input aria-label={t('connect.agentDisplayNameLabel')} value={form.displayName} onChange={(e) => form.setDisplayName(e.target.value)} placeholder={placeholder} maxLength={64} className="h-10 text-sm" />
      <FieldDescription>{t('connect.agentDisplayNameHint')}</FieldDescription>
    </Field>
  );
}

/** The agent's name, fixed when editing an existing agent. */
export function AgentNameField({ form, concise = false }: { form: AgentSetupForm; concise?: boolean }) {
  const t = useT();
  const { isEdit, selected, name, nameError, nameClash, canRename } = form;
  return (
    <Field data-invalid={!!(nameError || nameClash) || undefined}>
      <FieldLabel>
        {t('connect.nodeAgentNameLabel')}
        {/* Locked when editing, so only a new agent asks for it. */}
        {!isEdit && <>{' '}<span className="text-destructive">* {t('connect.requiredMark')}</span></>}
      </FieldLabel>
      <Input required={!isEdit} data-testid="agent-setup-name" aria-label={t('connect.nodeAgentNameLabel')} aria-invalid={!!(nameError || nameClash)} value={name} onChange={(e) => { form.setName(e.target.value); form.setNameError(null); form.nameTouchedFor.current = selected; }} placeholder={t('connect.nodeAgentNamePlaceholder')} className="h-10 text-sm" disabled={isEdit} />
      {nameError || nameClash
        ? <FieldError data-testid="agent-setup-name-error">{nameError || nameClash}</FieldError>
        : !isEdit && !concise && <FieldDescription>{t('connect.agentNameUniqueHint')}</FieldDescription>}
      {/* Always on, not a tooltip: a second agent of a type someone
          already runs is a different name away, nothing more. */}
      {!isEdit && selected && !concise && (
        <FieldDescription data-testid="agent-setup-name-hint">
          {t('connect.agentNameMultiHint', { first: defaultAgentNameBase(selected), second: `${defaultAgentNameBase(selected)}-2` })}
        </FieldDescription>
      )}
      {canRename && <FieldDescription>{t('connect.agentNameFixedHint')}</FieldDescription>}
    </Field>
  );
}

/** Working directory — optional, managed default, with a folder picker. */
export function WorkingDirectoryField({ form, api, node, extensions }: { form: AgentSetupForm } & Pick<AgentSetupProps, 'api' | 'node' | 'extensions'>) {
  const t = useT();
  const { workingDir, setWorkingDir, showPicker, setShowPicker } = form;
  const browse = () => {
    if (extensions?.browseFolder) {
      void extensions.browseFolder(workingDir).then((path) => { if (path) setWorkingDir(path); }).catch((err) => toast.error(String(err)));
    } else setShowPicker((v) => !v);
  };
  return (
    <Field>
      <FieldLabel>{t('connect.nodeWorkingDirOptional')}</FieldLabel>
      <div className="flex gap-2">
        <Input data-testid="agent-setup-workdir" aria-label={t('connect.nodeWorkingDirOptional')} value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder={extensions?.workingDirectoryPlaceholder || t('connect.nodeWorkingDirPlaceholder')} className="h-10 flex-1 font-mono text-sm" />
        <Button type="button" variant="outline" onClick={browse} className="h-10 shrink-0">
          <Folder data-icon="inline-start" />{t('connect.nodeBrowse')}
        </Button>
      </div>
      {showPicker && (
        <FolderPicker api={api}
          node={node}
          onPick={(p) => setWorkingDir(p)}
          onClose={() => setShowPicker(false)}
        />
      )}
      <FieldDescription>{extensions?.workingDirectoryHint || t('connect.nodeWorkingDirHint')}</FieldDescription>
    </Field>
  );
}
