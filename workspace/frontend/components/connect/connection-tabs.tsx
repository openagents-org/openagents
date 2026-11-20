'use client';

import { Cloud, Server } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/lib/i18n';

/** Devices or cloud agents. The view below renders the chosen tab's content. */
export function ConnectionTabs({ activeTab, onSelect }: {
  activeTab: 'node' | 'cloud';
  onSelect: (tab: 'node' | 'cloud') => void;
}) {
  const t = useT();
  return (
    <div className="shrink-0 px-6 pt-4 pb-2">
      <Tabs value={activeTab} onValueChange={(value) => onSelect(value as 'node' | 'cloud')} className="mx-auto w-full max-w-2xl">
        <TabsList aria-label={t('connect.title')} className="w-full">
          <TabsTrigger value="node"><Server />{t('connect.tabNode')}</TabsTrigger>
          <TabsTrigger value="cloud"><Cloud />{t('connect.tabCloud')}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
