'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty, SettingsList } from '@/components/settings/settings-list';
import type { HubApiKey, HubCredentials } from '@/lib/account-api';
import { useT } from '@/lib/i18n';
import { usageLine } from './api-key-box';

/** Everything that can reach the person's agents: OAuth apps and the API key. */
export function ConnectedAppList({ data, apiKey, onRevoke }: {
  data: HubCredentials;
  apiKey: HubApiKey | null;
  onRevoke: (id: string, message: string) => void;
}) {
  const t = useT();
  const empty = data.connected_apps.length === 0 && !apiKey;
  return (
    <SettingsCard
      title={t('hubApps.appsTitle')}
      action={(
        <Button variant="link" size="sm" className="h-auto px-0" asChild>
          <a href={data.docs_url} target="_blank" rel="noopener noreferrer">
            {t('hubApps.docsLink')}
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      )}
    >
      {empty ? (
        <ListEmpty>{t('hubApps.appsEmpty')}</ListEmpty>
      ) : (
        <SettingsList>
          {data.connected_apps.map((connected) => (
            <Item key={connected.client_id} size="sm">
              <ItemContent className="min-w-0">
                <ItemTitle>{connected.name}</ItemTitle>
                <ItemDescription className="text-xs">
                  {usageLine(t, 'hubApps.connectedOn', connected.connected_at, connected.last_used_at)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="destructive" size="sm" onClick={() => onRevoke(connected.id, t('hubApps.disconnectConfirm', { name: connected.name }))}>
                  {t('hubApps.disconnect')}
                </Button>
              </ItemActions>
            </Item>
          ))}
          {apiKey && (
            <Item key="api-key" size="sm">
              <ItemContent className="min-w-0">
                <ItemTitle>
                  {t('hubApps.keysTitle')}
                  <code className="font-mono text-xs text-muted-foreground">{apiKey.prefix}…</code>
                </ItemTitle>
                <ItemDescription className="text-xs">
                  {usageLine(t, 'hubApps.createdOn', apiKey.created_at, apiKey.last_used_at)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="destructive" size="sm" onClick={() => onRevoke(apiKey.id, t('hubApps.revokeConfirm', { name: t('hubApps.keysTitle') }))}>
                  {t('hubApps.revoke')}
                </Button>
              </ItemActions>
            </Item>
          )}
        </SettingsList>
      )}
    </SettingsCard>
  );
}
