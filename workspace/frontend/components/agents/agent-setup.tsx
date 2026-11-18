'use client';
import React from 'react';
import { useT } from '@/lib/i18n';
import { AgentIcon } from '@/components/icons/agent-icons';
import type { AgentSetupProps } from './agent-setup-types';
import { CompactTypePicker } from './agent-setup-compact';
import { MarketGallery } from './agent-setup-market';
import { runtimeStatus } from './agent-setup-status';
import { AgentSetupConfigView } from './agent-setup-config-view';
import { useAgentSetupForm } from './use-agent-setup-form';
import { useAgentSubmit } from './use-agent-submit';

export type { AgentSetupApi, AgentSetupExtensions, AgentDraft, CatalogState, AgentSetupProps } from './agent-setup-types';

/** An agent's app icon at gallery size. */
export function MarketLogo({ name, size, className }: { name: string; size: number; className?: string }) {
  return <AgentIcon name={name} size={size} className={className} />;
}

export function AgentSetup(props: AgentSetupProps) {
  const { catalog, catalogState, extensions, contextLabel, node, onBack } = props;
  const t = useT();
  const form = useAgentSetupForm(props);
  const create = useAgentSubmit(props, form);
  const { selectedEntry, runtimeByType, detecting, detectTimedOut, reDetect, marketQuery, setMarketQuery, marketCat, setMarketCat, pick } = form;

  // ---- Config mode: a focused, full-view form for the chosen agent ----------
  if (selectedEntry) {
    return <AgentSetupConfigView form={form} props={props} entry={selectedEntry} onSubmit={create} />;
  }

  // ---- Selection mode: the agent marketplace --------------------------------
  const statusOf = (name: string) => runtimeStatus(runtimeByType[name]);
  const checkingOf = (name: string) => detecting && !runtimeByType[name];
  const readyCount = catalog.filter((e) => {
    const s = statusOf(e.name);
    return s === 'ready' || s === 'needs_login';
  }).length;

  const marketCats = [
    { key: 'all', label: t('connect.marketCatAll') },
    { key: 'ready', label: t('connect.marketCatReady') },
    { key: 'open-source', label: t('connect.marketCatOpenSource') },
    { key: 'cli', label: t('connect.marketCatTerminal') },
    { key: 'editor', label: t('connect.marketCatIde') },
  ];
  const q = marketQuery.trim().toLowerCase();
  const visible = catalog.filter((e) => {
    const s = statusOf(e.name);
    const tags = e.tags || [];
    if (marketCat === 'ready' && s !== 'ready' && s !== 'needs_login') return false;
    if (marketCat === 'open-source' && !tags.includes('open-source')) return false;
    if (marketCat === 'cli' && !(tags.includes('cli') || tags.includes('terminal'))) return false;
    if (marketCat === 'editor' && !(tags.includes('editor') || tags.includes('vscode') || tags.includes('ide-extension'))) return false;
    if (!q) return true;
    return [e.name, e.label, e.vendor || '', e.description, ...tags].join(' ').toLowerCase().includes(q);
  });
  const shared = {
    catalog, catalogState, visible, readyCount, detecting, detectTimedOut,
    onReDetect: () => void reDetect(),
    categories: marketCats, category: marketCat, onCategory: setMarketCat,
    query: marketQuery, onQuery: setMarketQuery, statusOf, checkingOf, onPick: pick, onBack,
  };

  if (extensions?.compact) {
    return <CompactTypePicker {...shared} breadcrumbRoot={extensions.breadcrumbRoot} />;
  }

  return (
    <MarketGallery
      {...shared}
      onPreload={(type) => { void props.api.getAgentCatalogDetail(type).catch(() => {}); }}
      subtitle={contextLabel || t('connect.agentRunsOn', { device: node.name })}
    />
  );
}
