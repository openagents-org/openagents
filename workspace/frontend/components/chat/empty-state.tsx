'use client';

import { MessageCircle } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useT } from '@/lib/i18n';

export function EmptyConversation({ name, human = false, self = false }: { name?: string; human?: boolean; self?: boolean }) {
  const t = useT();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MessageCircle /></EmptyMedia>
        <EmptyTitle>{self ? t('peopleMessaging.selfDmTitle') : name ? t('onboarding.conversationWith', { name }) : t('onboarding.allSetTitle')}</EmptyTitle>
        <EmptyDescription>{t(self ? 'peopleMessaging.selfDmBody' : human ? 'onboarding.humanConversationBody' : 'onboarding.allSetBody')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
