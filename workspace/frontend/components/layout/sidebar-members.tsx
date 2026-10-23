'use client';
import { DmUnreadBadge } from './dm-unread-badge';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, ChevronRight, Settings } from 'lucide-react';
import { currentRouteSearch } from '@/lib/route-search';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';
import { dmSessionId, myAddress } from '@/lib/dm';
import { sidebarMembers, onlineMemberNames } from '@/lib/sidebar-members';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/responsive-dialog';
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuAction } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { cn, hasTruncatedLabel } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export function SidebarMembers({ showLabels, onNavigate }: { showLabels: boolean; onNavigate?: () => void }) {
  const t = useT();
  const team = useTeamRoster();
  const { workspace, currentUser, onlineUsers, dmConversations, unreadDmCounts, setCurrentSessionId, currentSessionId } = useWorkspace();
  const router = useRouter();
  const { openView, openMobileDetail, setSelectedAgentName, setThreadFilter } = useLayout();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // With labels, a row repeats its name in a tooltip only when it is cut off.
  const [truncatedMember, setTruncatedMember] = useState<string | null>(null);
  const me = myAddress(currentUser);
  const members = sidebarMembers(team, onlineUsers, dmConversations, me, currentUser.name);
  const online = onlineMemberNames(team, onlineUsers);
  const shownEmails = new Set(members.map(person => person.email));
  const moreCount = team.filter(person => !shownEmails.has(person.email.toLowerCase())).length;
  const memberLabel = (email: string, name: string) => email.toLowerCase() === currentUser.id.toLowerCase() ? `${name} (${t('threads.you')})` : name;
  const candidates = team.filter(person => `${person.displayName || ''} ${person.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const startDM = (email: string) => {
    setSelectedAgentName(null);
    setCurrentSessionId(dmSessionId(me, `human:${email.toLowerCase()}`));
    openView('threads'); setThreadFilter('dms'); openMobileDetail(); setOpen(false); onNavigate?.();
  };
  return <>
    <div className="px-3"><Separator /></div>
    <SidebarGroup className="px-1.5">
      <div className={cn('flex items-center', !showLabels && 'justify-center')}>
        {showLabels && <SidebarGroupLabel className="flex-1 px-2"><Users className="me-1 size-3" />{t('nav.members')}</SidebarGroupLabel>}
        <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label={t('nav.newHumanDM')} title={t('nav.newHumanDM')} onClick={() => { setQuery(''); setOpen(true); }}><Plus className="size-3.5" /></button>
      </div>
      <SidebarGroupContent><SidebarMenu className="gap-0.5">
        {members.map(person => <SidebarMenuItem key={person.email}>
          <SidebarMenuButton className={cn(!showLabels && 'justify-center!', !person.hasHistory && 'text-muted-foreground opacity-55')} aria-label={memberLabel(person.email, person.name)} tooltip={{ children: memberLabel(person.email, person.name), hidden: showLabels && truncatedMember !== person.email }} onPointerEnter={(e) => setTruncatedMember(hasTruncatedLabel(e.currentTarget) ? person.email : null)} isActive={currentSessionId === dmSessionId(me, `human:${person.email}`)} onClick={() => startDM(person.email)}>
            <span className="relative shrink-0"><HumanAvatar email={person.email} />{person.online && <span className="absolute bottom-0 right-0 size-1.5 rounded-full bg-emerald-500 ring-1 ring-sidebar" />}</span>
            {showLabels && <span className="flex min-w-0 items-center gap-1"><span className="truncate" data-truncatable>{person.name}</span>{person.email === currentUser.id.toLowerCase() && <span className="shrink-0 text-xs text-muted-foreground">({t('threads.you')})</span>}</span>}
            <DmUnreadBadge count={unreadDmCounts[dmSessionId(me, `human:${person.email}`)]} compact={!showLabels} />
          </SidebarMenuButton>
          {/* Your own row carries a settings button, as an agent's does: it
              opens the profile page where the name and avatar are edited. */}
          {showLabels && person.email === currentUser.id.toLowerCase() && workspace?.slug && (
            <SidebarMenuAction
              aria-label={t('nav.editProfile')}
              title={t('nav.editProfile')}
              className="top-1.5! text-muted-foreground"
              onClick={() => { router.push(`/${workspace.slug}/settings/profile${currentRouteSearch()}`); onNavigate?.(); }}
            >
              <Settings />
            </SidebarMenuAction>
          )}
        </SidebarMenuItem>)}
      </SidebarMenu>
        {team.length > 0 && <button type="button" onClick={() => { setQuery(''); setOpen(true); }} className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" title={t('nav.viewAllMembers')} aria-label={t('nav.viewAllMembers')}>
          {showLabels && <span className="flex-1 text-left">{moreCount > 0 ? t('nav.moreMembers', { count: moreCount }) : t('nav.viewAllMembers')}</span>}<ChevronRight className="size-3.5 shrink-0" />
        </button>}
      </SidebarGroupContent>
    </SidebarGroup>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{t('nav.members')} · {team.length}</DialogTitle></DialogHeader>
      <DialogBody className="space-y-3">
        <Input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('nav.searchMembers')} />
        <div className="max-h-80 overflow-y-auto">
          {candidates.map(person => <button key={person.email} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted" onClick={() => startDM(person.email)}>
            <span className="relative shrink-0"><HumanAvatar email={person.email} />{(online.has(person.email.toLowerCase()) || person.email.toLowerCase() === currentUser.id.toLowerCase()) && <span className="absolute bottom-0 right-0 size-1.5 rounded-full bg-emerald-500 ring-1 ring-background" aria-label={t('agents.online')} />}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{memberLabel(person.email, person.displayName || (person.email.toLowerCase() === currentUser.id.toLowerCase() ? currentUser.name : '') || person.email)}</span>{person.displayName && <span className="block truncate text-xs text-muted-foreground">{person.email}</span>}</span>
          </button>)}
          {!candidates.length && <p className="p-2 text-sm text-muted-foreground">{t('nav.noMembersFound')}</p>}
        </div>
      </DialogBody>
    </DialogContent></Dialog>
  </>;
}
