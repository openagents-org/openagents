'use client';

import { MessageSquare, MessageSquarePlus, Plus, Search } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import type { FilterTab } from './thread-list-utils';

interface ThreadListEmptyProps {
  tab: FilterTab;
  isSearching: boolean;
  onClearSearch: () => void;
  onNewThread: () => void;
  onNewChannel: () => void;
}

export function ThreadListEmpty({ tab, isSearching, onClearSearch, onNewThread, onNewChannel }: ThreadListEmptyProps) {
  const t = useT();
  const copy: Record<FilterTab, string> = {
    all: t('threads.emptyAll'),
    channels: t('threads.emptyChannels'),
    starred: t('threads.emptyStarred'),
    archived: t('threads.emptyArchived'),
    dms: t('threads.emptyDms'),
  };
  const action = isSearching ? (
    <Button variant="outline" size="sm" onClick={onClearSearch}>{t('threads.clearSearch')}</Button>
  ) : tab === 'all' ? (
    <Button variant="outline" size="sm" onClick={onNewThread}>
      <MessageSquarePlus data-icon="inline-start" />
      {t('threads.newThread')}
    </Button>
  ) : tab === 'channels' ? (
    <Button size="sm" onClick={onNewChannel}>
      <Plus data-icon="inline-start" />
      {t('threads.newChannel')}
    </Button>
  ) : null;

  return (
    <Empty className="flex-1 px-4 py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {isSearching ? <Search /> : <MessageSquare />}
        </EmptyMedia>
        <EmptyDescription className="text-xs">{isSearching ? t('threads.emptySearch') : copy[tab]}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
