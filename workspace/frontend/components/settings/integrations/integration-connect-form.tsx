'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';
import type { IntegrationBinding, WorkspaceAgent } from '@/lib/types';
import { IntegrationAgentSelect } from './integration-agent-select';

export type ChatPlatform = 'telegram' | 'slack' | 'lark';

const COPY: Record<ChatPlatform, { help: MessageKey; token: MessageKey; tokenPlaceholder?: MessageKey; connect: MessageKey }> = {
  telegram: {
    help: 'admin.telegramHelp',
    token: 'admin.telegramTokenLabel',
    tokenPlaceholder: 'admin.telegramTokenPlaceholder',
    connect: 'admin.connectTelegram',
  },
  slack: {
    help: 'admin.slackHelp',
    token: 'admin.slackTokenLabel',
    tokenPlaceholder: 'admin.slackTokenPlaceholder',
    connect: 'admin.connectSlack',
  },
  lark: { help: 'admin.larkHelp', token: 'admin.larkAppSecretLabel', connect: 'admin.connectLark' },
};

/**
 * Credentials for bridging one chat platform by hand. Mounted fresh for each
 * platform the admin opens, so switching platforms starts from empty fields.
 */
export function IntegrationConnectForm({
  platform,
  agents,
  onConnected,
}: {
  platform: ChatPlatform;
  agents: WorkspaceAgent[];
  onConnected: (binding: IntegrationBinding) => void;
}) {
  const t = useT();
  const copy = COPY[platform];
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [appId, setAppId] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [encryptKey, setEncryptKey] = useState('');
  const [defaultAgent, setDefaultAgent] = useState('');
  const [connecting, setConnecting] = useState(false);

  const incomplete =
    !botToken.trim() ||
    (platform === 'slack' && !signingSecret.trim()) ||
    (platform === 'lark' && (!appId.trim() || !verificationToken.trim()));

  const connect = async () => {
    if (incomplete) return;
    setConnecting(true);
    try {
      const binding = await workspaceApi.createIntegration({
        platform,
        botToken: botToken.trim(),
        signingSecret: platform === 'slack' ? signingSecret.trim() : undefined,
        appId: platform === 'lark' ? appId.trim() : undefined,
        verificationToken: platform === 'lark' ? verificationToken.trim() : undefined,
        encryptKey: platform === 'lark' ? encryptKey.trim() || undefined : undefined,
        defaultAgent: defaultAgent || undefined,
      });
      toast.success(t('admin.integrationConnected', { name: binding.name || binding.platform }));
      onConnected(binding);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('admin.integrationConnectFailed', { error: message.slice(0, 200) }));
    } finally {
      setConnecting(false);
    }
  };

  const secretField = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder = '') => (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
    </Field>
  );

  return (
    <Card size="sm">
      <CardContent>
        <FieldGroup className="gap-4">
          <FieldDescription>{t(copy.help)}</FieldDescription>
          {platform === 'lark' && secretField('integration-app-id', t('admin.larkAppIdLabel'), appId, setAppId, 'cli_…')}
          {secretField(
            'integration-bot-token',
            t(copy.token),
            botToken,
            setBotToken,
            copy.tokenPlaceholder ? t(copy.tokenPlaceholder) : '',
          )}
          {platform === 'slack' &&
            secretField(
              'integration-signing-secret',
              t('admin.slackSigningSecretLabel'),
              signingSecret,
              setSigningSecret,
              t('admin.slackSigningSecretPlaceholder'),
            )}
          {platform === 'lark' && (
            <>
              {secretField(
                'integration-verification-token',
                t('admin.larkVerificationTokenLabel'),
                verificationToken,
                setVerificationToken,
                t('admin.larkCredentialsHint'),
              )}
              {secretField(
                'integration-encrypt-key',
                t('admin.larkEncryptKeyLabel'),
                encryptKey,
                setEncryptKey,
                t('admin.larkEncryptKeyPlaceholder'),
              )}
            </>
          )}
          <Field>
            <FieldLabel htmlFor="integration-default-agent">{t('admin.integrationDefaultAgent')}</FieldLabel>
            <IntegrationAgentSelect
              id="integration-default-agent"
              value={defaultAgent}
              agents={agents}
              onChange={setDefaultAgent}
            />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end">
        <Button size="sm" onClick={connect} disabled={connecting || incomplete}>
          {connecting && <Spinner data-icon="inline-start" />}
          {t(copy.connect)}
        </Button>
      </CardFooter>
    </Card>
  );
}
