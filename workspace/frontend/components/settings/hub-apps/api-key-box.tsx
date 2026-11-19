'use client';

import { KeyRound, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ui/code-block';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import type { HubApiKey } from '@/lib/account-api';
import { useT, type TranslateFn } from '@/lib/i18n';

/** A value to paste somewhere else, wrapped in full, with a copy button. */
export function CopyBlock({ value, label }: { value: string; label?: string }) {
  const t = useT();
  return (
    <CodeBlock size="sm">
      <CodeBlockHeader>
        {label && <CodeBlockTitle>{label}</CodeBlockTitle>}
        <CodeBlockActions>
          <CodeBlockCopyButton value={value} copyLabel={t('hubApps.copy')} copiedLabel={t('hubApps.copied')} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap>{value}</CodeBlockContent>
    </CodeBlock>
  );
}

/** "Created … · Last used …" for a key or a connected app. */
export function usageLine(t: TranslateFn, firstKey: 'hubApps.createdOn' | 'hubApps.connectedOn', first: string | null, lastUsed: string | null) {
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
  return `${t(firstKey, { date: date(first) })} · ${lastUsed ? t('hubApps.lastUsed', { date: date(lastUsed) }) : t('hubApps.neverUsed')}`;
}

/**
 * The person's one API key: create it, or regenerate it (which retires the
 * old one). The secret is shown once, right after it is made.
 */
export function ApiKeyBox({ apiKey, fresh, busy, onCreate }: {
  apiKey: HubApiKey | null; fresh: string | null; busy: boolean; onCreate: (replace: boolean) => void;
}) {
  const t = useT();
  if (fresh) {
    return (
      <Alert>
        <KeyRound className="text-warning" />
        <AlertTitle>{t('hubApps.newKeyTitle')}</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          {t('hubApps.newKeyHint')}
          <CopyBlock value={fresh} label={t('hubApps.keysTitle')} />
        </AlertDescription>
      </Alert>
    );
  }
  if (!apiKey) {
    return (
      <div>
        <Button onClick={() => onCreate(false)} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
          {t('hubApps.createKey')}
        </Button>
      </div>
    );
  }
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <KeyRound className="text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="font-mono text-xs">{apiKey.prefix}…</ItemTitle>
        <ItemDescription className="text-xs">
          {usageLine(t, 'hubApps.createdOn', apiKey.created_at, apiKey.last_used_at)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" onClick={() => onCreate(true)} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          {t('hubApps.regenerateKey')}
        </Button>
      </ItemActions>
    </Item>
  );
}
