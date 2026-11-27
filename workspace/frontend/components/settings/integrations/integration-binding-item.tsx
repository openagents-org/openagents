'use client';

import { Bot, Send, Slack, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item';
import { CopyInput } from '@/components/settings/copy-input';
import { IconAction } from '@/components/settings/icon-action';
import { useT } from '@/lib/i18n';
import type { IntegrationBinding, WorkspaceAgent } from '@/lib/types';
import { IntegrationAgentSelect } from './integration-agent-select';

function PlatformIcon({ platform }: { platform: string }) {
  const Icon = platform === 'slack' ? Slack : platform === 'lark' ? Bot : Send;
  return <Icon className="size-5 text-muted-foreground" />;
}

/** The URL a platform's app has to post events to, with a copy button. */
function EventsUrl({ id, label, url, hint }: { id: string; label: string; url: string; hint: string }) {
  const t = useT();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <CopyInput id={id} value={url} className="w-full" onCopy={() => toast.success(t('admin.copied'))} />
      <FieldDescription>{hint}</FieldDescription>
    </Field>
  );
}

/** Health as a word: disabled, failing (the error is spelled out below), or active. */
function HealthBadge({ binding: b }: { binding: IntegrationBinding }) {
  const t = useT();
  if (b.status !== 'active') return <Badge variant="secondary">{t('admin.integrationDisabled')}</Badge>;
  if (b.lastError) return <Badge variant="warning">{t('common.error')}</Badge>;
  return <Badge variant="success">{t('admin.integrationActive')}</Badge>;
}

/** One connected chat platform: its health, default agent and events URL. */
export function IntegrationBindingItem({
  binding: b,
  agents,
  editable,
  onChangeAgent,
  onRemove,
}: {
  binding: IntegrationBinding;
  agents: WorkspaceAgent[];
  editable: boolean;
  onChangeAgent: (agent: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const meta = [
    b.botTokenMasked,
    b.lastEventAt && t('admin.lastSeen', { time: new Date(b.lastEventAt).toLocaleString() }),
  ]
    .filter(Boolean)
    .join(' · ');
  const eventsUrl =
    b.platform === 'slack' && b.slackEventsUrl
      ? { label: t('admin.slackEventsUrlLabel'), url: b.slackEventsUrl, hint: t('admin.slackEventsUrlHint') }
      : b.platform === 'lark' && b.larkEventsUrl
        ? { label: t('admin.larkEventsUrlLabel'), url: b.larkEventsUrl, hint: t('admin.larkEventsUrlHint') }
        : null;

  return (
    <Item size="sm">
      <ItemMedia>
        <PlatformIcon platform={b.platform} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          <span className="truncate">{b.name || b.platform}</span>
          <HealthBadge binding={b} />
        </ItemTitle>
        {meta && <ItemDescription className="line-clamp-1">{meta}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        <IntegrationAgentSelect
          value={b.defaultAgent || ''}
          agents={agents}
          disabled={!editable}
          onChange={onChangeAgent}
        />
        {editable && (
          <IconAction size="icon" label={t('admin.integrationRemove')} destructive onClick={onRemove}>
            <Trash2 />
          </IconAction>
        )}
      </ItemActions>
      {(eventsUrl || b.lastError) && (
        <ItemFooter className="flex-col items-stretch gap-3">
          {eventsUrl && <EventsUrl id={`integration-events-url-${b.id}`} {...eventsUrl} />}
          {b.lastError && (
            <p className="text-xs wrap-break-word text-warning">{t('admin.integrationLastError', { error: b.lastError })}</p>
          )}
        </ItemFooter>
      )}
    </Item>
  );
}
