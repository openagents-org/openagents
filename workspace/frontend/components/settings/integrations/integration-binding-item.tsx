'use client';

import { Bot, Copy, Send, Slack, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useT } from '@/lib/i18n';
import type { IntegrationBinding, WorkspaceAgent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { IntegrationAgentSelect } from './integration-agent-select';

function PlatformIcon({ platform }: { platform: string }) {
  const Icon = platform === 'slack' ? Slack : platform === 'lark' ? Bot : Send;
  return <Icon className="size-5 shrink-0 text-muted-foreground" />;
}

/** The URL a platform's app has to post events to, with a copy button. */
function EventsUrl({ label, url, hint }: { label: string; url: string; hint: string }) {
  const t = useT();
  const { copyToClipboard } = useCopyToClipboard({ onCopy: () => toast.success(t('admin.copied')) });
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{url}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('admin.copied')}
          onClick={() => copyToClipboard(url)}
        >
          <Copy />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
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
  const healthy = b.status === 'active' && !b.lastError;
  const meta = [
    b.botTokenMasked,
    b.lastEventAt && t('admin.lastSeen', { time: new Date(b.lastEventAt).toLocaleString() }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <PlatformIcon platform={b.platform} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {b.name || b.platform}
            <span
              className={cn('size-2 shrink-0 rounded-full', healthy ? 'bg-success' : 'bg-warning')}
              title={b.status === 'active' ? b.lastError || b.status : t('admin.integrationDisabled')}
            />
          </p>
          <p className="truncate text-xs text-muted-foreground">{meta}</p>
        </div>
        <IntegrationAgentSelect
          value={b.defaultAgent || ''}
          agents={agents}
          disabled={!editable}
          onChange={onChangeAgent}
        />
        {editable && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            title={t('admin.integrationRemove')}
            aria-label={t('admin.integrationRemove')}
            className="text-muted-foreground"
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {b.platform === 'slack' && b.slackEventsUrl && (
        <EventsUrl label={t('admin.slackEventsUrlLabel')} url={b.slackEventsUrl} hint={t('admin.slackEventsUrlHint')} />
      )}
      {b.platform === 'lark' && b.larkEventsUrl && (
        <EventsUrl label={t('admin.larkEventsUrlLabel')} url={b.larkEventsUrl} hint={t('admin.larkEventsUrlHint')} />
      )}
      {b.lastError && (
        <p className="truncate text-xs text-warning">{t('admin.integrationLastError', { error: b.lastError })}</p>
      )}
    </div>
  );
}
