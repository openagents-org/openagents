'use client';
import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useT } from '@/lib/i18n';
import { SHARED_CONFIG_TYPES, type AgentSetupProps } from './agent-setup-types';
import { SmokeTestPanel } from './smoke-test-panel';
import { AgentStatusHint, ProviderLockedHow, SameTypeAgents } from './agent-setup-status-hint';
import { AgentNameField, DisplayNameField, WorkingDirectoryField } from './agent-setup-name-fields';
import { ByokSection } from './agent-setup-byok';
import { CodexModeField, CuratedModelField } from './agent-setup-model-fields';
import { NativeCredentialFields, OptionalCredentialFields } from './agent-setup-credentials';
import type { AgentSetupForm } from './use-agent-setup-form';

/** The agent form itself, shared by the desktop and the web layouts. */
export function AgentSetupFormBody({ form, props }: { form: AgentSetupForm; props: AgentSetupProps }) {
  const t = useT();
  const { node, api, extensions, editAgent, onManageAgent, onChanged } = props;
  const { isEdit, selected, selectedEntry, selectedStatus, detail, byok, byokState, nativeCreds, baseUrl, creds, canRename, busy } = form;
  const configured = !!extensions?.configuration;
  const sameType = node.agents.filter((agent) => agent.type === selected);
  const { pickerModels } = creds;
  return (
    <>
      {!isEdit && onManageAgent && sameType.length > 0 && (
        <SameTypeAgents form={form} agents={sameType} onManageAgent={onManageAgent} />
      )}

      {/* Config card */}
      <fieldset disabled={busy} className={extensions?.compact ? 'flex min-w-0 flex-col gap-5' : 'flex min-w-0 flex-col gap-4 rounded-2xl border bg-background p-5'}>
        {!configured && <AgentStatusHint form={form} node={node} />}

        {detail?.provider_locked && selectedStatus !== 'ready' && <ProviderLockedHow form={form} />}

        {/* Smoke test — per AGENT, so it only exists once the agent does
            (probes run automatically after create/reconfigure and hourly;
            nothing is probed for a bare agent type). */}
        {isEdit && editAgent && !configured && (
          <SmokeTestPanel api={api}
            nodeId={node.nodeId}
            agentName={editAgent.name}
            probe={(node.agents || []).find((a) => a.name === editAgent.name)?.probe}
            onChanged={onChanged}
          />
        )}

        {canRename && <DisplayNameField form={form} placeholder={editAgent!.name} />}
        <AgentNameField form={form} />

        {selected && extensions?.configuration?.({ type: selected, name: editAgent?.name, onChanged,
          workingDirectory: extensions.inlineWorkingDirectory ? { value: form.workingDir, onChange: form.setWorkingDir } : undefined })}

        {selected && SHARED_CONFIG_TYPES.has(selected) && !configured && (
          <Alert data-testid="agent-setup-shared-config">
            <TriangleAlert className="text-warning" />
            <AlertDescription>{t('connect.agentSharedConfigHint', { label: selectedEntry?.label ?? selected })}</AlertDescription>
          </Alert>
        )}

        {byok && <ByokSection form={form} node={node} editAgent={editAgent} extensions={extensions} />}

        {creds.customCodex && <CodexModeField form={form} />}

        {/* Model — curated dropdown; hidden while a saved model access is
            driving the list (its live models replace the curated set). */}
        {!configured && pickerModels && !(byok && byokState.accessId) && !baseUrl.trim() && !(creds.keepCurrent && byok) && (
          <CuratedModelField form={form} pickerModels={pickerModels} />
        )}

        {/* A host that draws the working directory itself got its value
            through `configuration`. */}
        {!extensions?.inlineWorkingDirectory && <WorkingDirectoryField form={form} api={api} node={node} extensions={extensions} />}

        {/* Credentials — optional (BYOK agents configure them above instead) */}
        {!configured && !byok && (nativeCreds.length > 0
          ? <NativeCredentialFields form={form} />
          : <OptionalCredentialFields form={form} editAgent={editAgent} />)}
      </fieldset>
    </>
  );
}
