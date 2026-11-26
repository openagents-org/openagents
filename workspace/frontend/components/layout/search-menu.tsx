'use client';
import { isRoutineSession } from '@/lib/conversation-list';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Bot, CalendarClock, CircleDot, FileText, Globe, Inbox, MessageSquare, Search, Sparkles, Users, Waypoints,
} from 'lucide-react';
import { useMe } from '@/hooks/use-me';
import { canAccessSettingsSection } from '@/components/settings/admin-context';
import { SETTINGS_GROUPS } from '@/components/settings/settings-nav';
import { currentRouteSearch } from '@/lib/route-search';
import { useOpenConnect } from './onboarding-surface';
import type { ViewMode } from './layout-context';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { getFileIcon } from '@/components/files/file-utils';
import { agentLabel, isRecentAgent } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { useModKey } from '@/hooks/use-mod-key';
import { Kbd } from '@/components/ui/kbd';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useLayout } from './layout-context';

/** Other words people search a setting by, in both UI languages. */
const SETTING_KEYWORDS: Record<string, string[]> = {
  'model-access': ['API key', 'key', 'model', 'credential', 'provider', '密钥', '模型', '凭据', '服务商'],
  devices: ['device', 'computer', 'node', '设备', '电脑'],
  members: ['invite', 'people', '邀请', '成员'],
};

/** ⌘K palette over threads, files, agents, pages and settings. Its trigger is an ordinary
 * sidebar nav item (icon, "Search", ⌘K hint), not an input look-alike: it opens
 * the palette rather than taking typing in place. Icon-only on the collapsed
 * rail, where the tooltip carries the label. */
export function SearchMenu({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const { workspace, sessions, files, agents, setCurrentSessionId, setSelectedFileId } = useWorkspace();
  const { openView, setSelectedAgentName, openMobileDetail } = useLayout();
  const openConnect = useOpenConnect();
  const me = useMe(workspace?.slug || workspace?.workspaceId);
  const router = useRouter();
  const t = useT();
  const mod = useModKey();
  const shortcut = `${mod}${mod === '⌘' ? '' : '+'}K`;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const threads = sessions.filter((s) => !isRoutineSession(s));
  const recentAgents = agents.filter(isRecentAgent);

  // The rail's views, in its order, plus Manage Agents.
  const pages: { mode: ViewMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'connect', label: agents.some((a) => !a.builtin) ? t('nav.manageAgents') : t('nav.connectAgent'), icon: <Bot /> },
    { mode: 'threads', label: t('views.threads'), icon: <MessageSquare /> },
    { mode: 'issues', label: t('views.issues'), icon: <CircleDot /> },
    { mode: 'files', label: t('views.files'), icon: <FileText /> },
    { mode: 'browser', label: t('views.browser'), icon: <Globe /> },
    { mode: 'routines', label: t('views.routines'), icon: <CalendarClock /> },
    { mode: 'knowledge', label: t('views.knowledge'), icon: <BookOpen /> },
    { mode: 'inbox', label: t('views.inbox'), icon: <Inbox /> },
    { mode: 'skills', label: t('views.skills'), icon: <Sparkles /> },
    { mode: 'workflows', label: t('views.workflows'), icon: <Waypoints /> },
    ...(workspace?.settings?.services_enabled === true
      ? [{ mode: 'agents' as const, label: t('collab.viewAgents'), icon: <Users /> }]
      : []),
  ];
  const settings = SETTINGS_GROUPS.flatMap((group) => group.sections)
    .filter(({ slug }) => canAccessSettingsSection(me, slug));

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <>
      <SidebarMenuItem data-tour="search">
        <SidebarMenuButton
          onClick={() => setOpen(true)}
          aria-label={t('search.trigger', { shortcut })}
          tooltip={{ children: t('search.trigger', { shortcut }), hidden: !iconOnly }}
          className={iconOnly ? 'justify-center!' : undefined}
        >
          <Search />
          {!iconOnly && (
            <>
              <span className="truncate">{t('search.label')}</span>
              <Kbd className="ml-auto">{shortcut}</Kbd>
            </>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t('search.dialogTitle')}
        description={t('search.dialogDescription')}
      >
        {/* CommandDialog only renders the dialog shell — cmdk still needs its own root */}
        <Command>
          <CommandInput placeholder={t('search.placeholder')} />
          <CommandList>
            <CommandEmpty>{t('search.empty')}</CommandEmpty>

            {threads.length > 0 && (
              <CommandGroup heading={t('search.groupThreads')}>
                {threads.map((session) => (
                  <CommandItem
                    key={session.sessionId}
                    value={`thread ${session.title} ${session.sessionId}`}
                    onSelect={() =>
                      run(() => {
                        openView('threads');
                        setCurrentSessionId(session.sessionId);
                        openMobileDetail();
                      })
                    }
                  >
                    <MessageSquare />
                    <span className="truncate">{session.title || t('search.untitledThread')}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {files.length > 0 && (
              <CommandGroup heading={t('search.groupFiles')}>
                {files.map((file) => (
                  <CommandItem
                    key={file.id}
                    value={`file ${file.filename}`}
                    onSelect={() =>
                      run(() => {
                        openView('files');
                        setSelectedFileId(file.id);
                        openMobileDetail();
                      })
                    }
                  >
                    {getFileIcon(file.contentType, file.filename)}
                    <span className="truncate">{file.filename}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Pages and settings, so a control seen once can be found again
                by name instead of by hunting through the rail. */}
            <CommandGroup heading={t('search.groupPages')}>
              {pages.map((page) => (
                <CommandItem
                  key={page.mode}
                  value={`page ${page.label}`}
                  onSelect={() => run(() => {
                    if (page.mode === 'connect' && openConnect) openConnect(); else openView(page.mode);
                  })}
                >
                  {page.icon}
                  <span className="truncate">{page.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {settings.length > 0 && workspace && (
              <CommandGroup heading={t('search.groupSettings')}>
                {settings.map(({ slug, labelKey, icon: Icon }) => (
                  <CommandItem
                    key={slug}
                    value={`setting ${t(labelKey)}`}
                    keywords={SETTING_KEYWORDS[slug]}
                    onSelect={() => run(() => router.push(`/${workspace.slug}/settings/${slug}${currentRouteSearch()}`))}
                  >
                    <Icon />
                    <span className="truncate">{t(labelKey)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {recentAgents.length > 0 && (
              <CommandGroup heading={t('search.groupAgents')}>
                {recentAgents.map((agent) => (
                  <CommandItem
                    key={agent.agentName}
                    value={`agent ${agent.agentName} ${agentLabel(agent)}`}
                    onSelect={() => run(() => setSelectedAgentName(agent.agentName))}
                  >
                    <AgentAvatar
                      name={agent.agentName}
                      size={20}
                      status={agent.status}
                      className="[&_svg]:size-full!"
                    />
                    <span className="truncate">{agentLabel(agent)}</span>
                    {/* CommandShortcut, not a bare `ml-auto` span: CommandItem
                        always renders a trailing check icon that also carries
                        `ml-auto`, and two auto margins split the free space
                        between them — which parked the status mid-row. The
                        `data-slot` on CommandShortcut hides that check. */}
                    <CommandShortcut className="tracking-normal">
                      {agent.status === 'online' ? t('agentStatus.online') : t('agentStatus.offline')}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
