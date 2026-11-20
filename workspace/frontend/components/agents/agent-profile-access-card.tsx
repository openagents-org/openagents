'use client';

import { useState } from 'react';
import { Pencil, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { AgentCatalogDetail } from '@/lib/types';
import { ProfileSection } from './agent-profile-section';
import type { NodeAgentSettings } from './use-node-agent-settings';

const HINT = 'text-xs leading-relaxed text-muted-foreground';

/** Its credential is its own fields (CodeArts' AK/SK), not one API key: not edited here. */
const usesNativeCredentials = (d: AgentCatalogDetail) =>
  !d.resolve_env?.rules?.length && (d.env_config || []).some((f) => f.password && f.required && !f.name.startsWith('LLM_'));

/**
 * The API key and endpoint of a device agent that runs on a key, changed in
 * place with the same fields onboarding asks for. The device holds the key and
 * reports it masked; a new one goes to it encrypted. Agents on their CLI's own
 * sign-in have neither, so the card is not shown for them.
 */
export function AccessCard({ agentName, settings }: { agentName: string; settings: NodeAgentSettings }) {
  const t = useT();
  const { node, nodeAgent, detail } = settings;
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [custom, setCustom] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onKey = nodeAgent?.authMode === 'api_key' || (!nodeAgent?.authMode && !!nodeAgent?.apiKeyMasked);
  if (!node || !nodeAgent || !detail || !onKey || usesNativeCredentials(detail)) return null;
  const host = detail.provider_locked ? null : nodeAgent.baseUrlHost || null;

  const open = () => {
    setApiKey(''); setCustom(!!host); setBaseUrl(''); setModel(''); setError(null);
    setEditing(true);
  };
  const save = async () => {
    const key = apiKey.trim();
    const url = custom ? baseUrl.trim() : '';
    const m = custom ? model.trim() : '';
    // A new endpoint cannot run the model the old one served (see useAgentSubmit).
    if (url && !m) { setError(t('connect.nodeCustomModelRequired')); return; }
    const args: Record<string, unknown> = {
      ...(key ? { apiKey: key } : {}),
      ...(url ? { baseUrl: url } : !custom && host ? { baseUrl: '' } : {}),
      ...(m ? { model: m } : {}),
    };
    if (!Object.keys(args).length) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    try {
      const outcome = await settings.configure(args);
      // The workspace's model pick outranks the device's, so it moves too.
      if (m) await workspaceApi.updateMember(agentName, { model: m });
      toast.success(outcome === 'applied' ? t('agents.settingsSaved') : t('connect.nodeCommandQueued', { node: node.name }));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('connect.nodeCommandFailed'));
    } finally {
      setBusy(false);
    }
  };

  const editButton = !editing && (
    <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" onClick={open}>
      <Pencil data-icon="inline-start" />
      {t('agents.settingsEdit')}
    </Button>
  );

  return (
    <ProfileSection title={t('agents.accessTitle')} action={editButton}>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="profile-api-key">{t('agents.fieldApiKey')}</FieldLabel>
              <Input id="profile-api-key" type="password" autoComplete="off" spellCheck={false} autoFocus value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={nodeAgent.apiKeyMasked || t('agentSetup.keyPlaceholder')} />
              <FieldDescription>{t('agents.accessKeyKeep')}</FieldDescription>
            </Field>
            <div className={`flex items-start gap-2 ${HINT}`}><ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>{t('agentSetup.keySecurity', { device: node.name })}</p></div>
            {!detail.provider_locked && (
              <Field orientation="horizontal">
                <Checkbox id="profile-custom-endpoint" checked={custom} onCheckedChange={(checked) => setCustom(checked === true)} />
                <FieldLabel htmlFor="profile-custom-endpoint" className="font-normal">{t('agentSetup.customEndpoint')}</FieldLabel>
              </Field>
            )}
            {custom && (
              <>
                <Field>
                  <FieldLabel htmlFor="profile-endpoint">{t('agentSetup.endpoint')}</FieldLabel>
                  <Input id="profile-endpoint" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={host || 'https://api.example.com/v1'} />
                  {host && <FieldDescription>{t('agents.accessEndpointKeep', { host })}</FieldDescription>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-endpoint-model">{t('agentSetup.model')}</FieldLabel>
                  <Input id="profile-endpoint-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connect.nodeModelAuto')} />
                </Field>
              </>
            )}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm">
                {busy && <Spinner data-icon="inline-start" />}
                {t('common.save')}
              </Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">{t('agents.fieldApiKey')}</dt>
          <dd className="font-mono break-all">{nodeAgent.apiKeyMasked || '—'}</dd>
          <dt className="text-muted-foreground">{t('agents.accessEndpoint')}</dt>
          <dd className="font-mono break-all">{host || t('agents.accessOfficial')}</dd>
        </dl>
      )}
    </ProfileSection>
  );
}
