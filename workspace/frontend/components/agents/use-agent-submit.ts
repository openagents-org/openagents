'use client';
import { encryptAgentCredentials } from './encrypt-agent-credentials';
import { useRef } from 'react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { nodeCommandErrorKey } from '@/lib/node-command-error';
import type { AgentSetupProps } from './agent-setup-types';
import type { AgentSetupForm } from './use-agent-setup-form';

/** Adds the agent, or saves the one being edited, once the form allows it. */
export function useAgentSubmit({ node, api, extensions, editAgent, onBack, onChanged, onQueued }: AgentSetupProps, form: AgentSetupForm) {
  const t = useT();
  const submitting = useRef(false);
  const { isEdit, selected, takenNames, byok, byokState, creds, detail } = form;

  return async () => {
    const n = form.name.trim();
    const model = form.model.trim();
    const apiKey = form.apiKey.trim();
    const baseUrl = form.baseUrl.trim();
    const workingDir = form.workingDir.trim();
    const guided = !!extensions?.guided && !isEdit && !extensions?.compact && !extensions?.configuration;
    const setupLater = guided && form.setupAuth === 'later';
    if (!n || !selected || submitting.current) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(n)) { form.setNameError(t('connect.agentNameInvalid')); return; }
    if (!isEdit && node.agents.some((agent) => agent.name === n)) { form.setNameError(t('connect.agentNameExists')); return; }
    if (!isEdit && takenNames.has(n)) { form.setNameError(t('connect.agentNameTaken', { name: n })); return; }
    form.setNameError(null);
    // A key-only agent with no key: point at the credentials, every time. A
    // sign-in not confirmed: point at it once; the next click adds anyway.
    if (!setupLater && !guided && (creds.keyRequired || (creds.signInUnconfirmed && !isEdit && !creds.credsError))) {
      creds.setCredsError(true);
      requestAnimationFrame(() => {
        creds.credsFieldRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        creds.credsFieldRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
      });
      return;
    }
    // A custom endpoint cannot choose a usable model from the agent's built-in
    // provider defaults. Leaving this blank previously saved the key and URL
    // while the agent kept running its old/default OpenAI model.
    if (baseUrl && !model) { form.failModel(t('connect.nodeCustomModelRequired')); return; }
    if (byok && byokState.accessId && !model) { form.failModel(t('connect.byokModelRequired')); return; }
    if (creds.customCodex && form.codexWireApi === 'responses' && !creds.supportsCodexMode) { form.setError(t('connect.codexModeUpdate')); return; }
    // A device that already holds them (configured there) needs nothing from
    // here; otherwise a new agent cannot start without every one of them.
    const nativeConfig = Object.fromEntries(
      form.nativeCreds.map((f) => [f.name, (form.nativeValues[f.name] || '').trim()]).filter(([, v]) => v),
    );
    const missingNative = form.nativeCreds.find((f) => !nativeConfig[f.name]);
    if (!isEdit && !setupLater && form.selectedStatus !== 'ready' && missingNative) {
      form.setError(t('connect.nodeNativeCredRequired', { field: missingNative.name }));
      return;
    }
    const configArg = {
      ...(Object.keys(nativeConfig).length ? { config: nativeConfig } : {}),
      ...(creds.customCodex ? { codexWireApi: form.codexWireApi } : {}),
    };
    const accessArg = byok && byokState.accessId ? { modelAccessId: byokState.accessId } : {};
    submitting.current = true;
    form.setError(null);
    form.setBusy(true);
    try {
      if (isEdit) {
        await api.enqueueNodeCommand(node.nodeId, 'configure_agent', {
          name: n,
          type: selected,
          // Only a model that was changed: one this form never showed (a
          // launcher-saved CODEX_MODEL on an older device) went out blank and
          // wiped the model the agent ran on. '' still clears → Auto.
          ...(model !== (editAgent?.model ?? '').trim() ? { model } : {}),
          currentWorkingDir: editAgent?.workingDir || '',
          ...(workingDir ? { workingDir } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(baseUrl && !detail?.provider_locked ? { baseUrl } : {}),
          ...accessArg,
          ...((guided ? form.setupAuth === 'subscription' || (!form.setupAuth && (form.runtimeByType[selected]?.signedIn === true || form.runtimeByType[selected]?.auth?.mode === 'subscription')) : creds.signInChosen) ? { authMode: 'cli_login' } : {}),
          ...configArg,
        });
        // After the configuration, so a label the workspace refuses (too long,
        // taken by another agent) never costs the settings saved above.
        const label = form.displayName.trim();
        if (form.canRename && label !== (editAgent?.displayName ?? '').trim()) {
          await extensions!.renameAgent!(n, label);
        }
      } else {
        let createArgs: Record<string, unknown> = {
          name: n,
          type: selected,
          ...(workingDir ? { workingDir } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(baseUrl && !detail?.provider_locked ? { baseUrl } : {}),
          ...(model ? { model } : {}),
          ...accessArg,
          ...((guided ? form.setupAuth === 'subscription' || (!form.setupAuth && (form.runtimeByType[selected]?.signedIn === true || form.runtimeByType[selected]?.auth?.mode === 'subscription')) : creds.signInChosen) ? { authMode: 'cli_login' } : {}),
          ...configArg,
        };
        if (guided && (apiKey || configArg.config)) {
          try {
            createArgs = await encryptAgentCredentials(api, node.nodeId, 'create_agent', createArgs, t('agentSetup.secureUnavailable'));
          } catch { throw new Error(t('agentSetup.secureUnavailable')); }
        }
        const cmd = await api.enqueueNodeCommand(node.nodeId, 'create_agent', createArgs);
        // Optimistically show it spinning up in the node card. The commandId
        // lets the placeholder track the REAL install/config progress instead
        // of guessing from a timer.
        if (cmd?.deferred) {
          toast.success(t('connect.agentAddedAfterInstall', { name: n }));
        } else {
          onQueued?.({
            name: n, type: selected, commandId: cmd?.commandId,
            draft: {
              name: n, type: selected,
              workingDir: workingDir || undefined,
              apiKey: guided ? undefined : apiKey || undefined,
              baseUrl: baseUrl || undefined,
              model: model || undefined,
              modelAccessId: (byok && byokState.accessId) || undefined,
              codexWireApi: creds.customCodex ? form.codexWireApi : undefined,
              config: guided ? undefined : configArg.config,
            },
          });
          toast.success(extensions?.local ? t('connect.agentAdded') : t('connect.nodeCommandQueued', { node: node.name }));
        }
      }
      if (isEdit) toast.success(extensions?.local ? t('connect.agentSaved') : t('connect.nodeCommandQueued', { node: node.name }));
      if (extensions?.local) onChanged();
      else setTimeout(onChanged, 3000);
      onBack();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      const key = nodeCommandErrorKey(msg, !isEdit);
      // The device or workspace refused the name itself: point at the field.
      if (!isEdit && (key === 'connect.agentNameTaken' || /already exists/i.test(msg))) {
        form.setNameError(t(key ?? 'connect.agentNameExists', { name: n }));
      } else {
        form.setError(key ? t(key, { name: n }) : msg || t('connect.nodeCommandFailed'));
      }
    } finally {
      submitting.current = false;
      form.setBusy(false);
    }
  };
}
