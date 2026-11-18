'use client';
import { DmUnreadBadge } from './dm-unread-badge';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ChevronDown, ChevronRight, Settings, UserPlus } from 'lucide-react';
import { currentRouteSearch } from '@/lib/route-search';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';
import { dmSessionId, myAddress } from '@/lib/dm';
import { sidebarMembers, onlineMemberNames } from '@/lib/sidebar-members';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
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
  // Folds like the agents group above it. Labels only: icon-only, the avatars
  // are the rail's presence display and stay.
  const [membersOpen, setMembersOpen] = useState(true);
  const [query, setQuery] = useState('');
  // With labels, a row repeats its name in a tooltip only when it is cut off.
  const [truncatedMember, setTruncatedMember] = useState<string | null>(null);
  const me = myAddress(currentUser);
  const members = sidebarMembers(team, onlineUsers, dmConversations, me, currentUser.name, email => unreadDmCounts[dmSessionId(me, `human:${email}`)] || 0);
  const online = onlineMemberNames(team, onlineUsers);
  const shownEmails = new Set(members.map(person => person.email));
  // Online/total, the same reading as the agent group's heading.
  const membersLabel = t('nav.membersWithCount', { online: team.filter(person => online.has(person.email.toLowerCase())).length, total: team.length });
  const moreCount = team.filter(person => !shownEmails.has(person.email.toLowerCase())).length;
  const memberLabel = (email: string, name: string) => email.toLowerCase() === currentUser.id.toLowerCase() ? `${name} (${t('threads.you')})` : name;
  const candidates = team.filter(person => `${person.displayName || ''} ${person.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const openInvite = () => {
    if (!workspace?.slug) return;
    router.push(`/${workspace.slug}/settings/members${currentRouteSearch()}`);
    onNavigate?.();
  };
  const startDM = (email: string) => {
    setSelectedAgentName(null);
    setCurrentSessionId(dmSessionId(me, `human:${email.toLowerCase()}`));
    openView('threads'); setThreadFilter('all'); openMobileDetail(); setOpen(false); onNavigate?.();
  };
  return <>
    <div className="px-3"><Separator /></div>
    <SidebarGroup className="px-1.5">
      <div className={cn('flex items-center', !showLabels && 'justify-center')}>
        {showLabels && <SidebarGroupLabel asChild className="min-w-0 flex-1 cursor-pointer px-2 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none">
          <button type="button" onClick={() => setMembersOpen(prev => !prev)} aria-expanded={membersOpen} aria-controls="rail-member-list" title={membersLabel}>
            <span className="truncate">{membersLabel}</span>
            <ChevronDown className={cn('ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200', !membersOpen && '-rotate-90')} />
          </button>
        </SidebarGroupLabel>}
        {/* "+" adds people to the workspace; a DM with a teammate starts from
            their row, or from "N more" for everyone else. */}
        {workspace?.slug && <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={t('userMenu.inviteMembers')} title={t('userMenu.inviteMembers')} onClick={openInvite}><Plus /></Button>}
      </div>
      <SidebarGroupContent id="rail-member-list" className={cn(showLabels && !membersOpen && 'hidden')}><SidebarMenu className="gap-0.5">
        {members.map(person => <SidebarMenuItem key={person.email}>
          <SidebarMenuButton className={cn(!showLabels && 'justify-center!')} aria-label={memberLabel(person.email, person.name)} tooltip={{ children: memberLabel(person.email, person.name), hidden: showLabels && truncatedMember !== person.email }} onPointerEnter={(e) => setTruncatedMember(hasTruncatedLabel(e.currentTarget) ? person.email : null)} isActive={currentSessionId === dmSessionId(me, `human:${person.email}`)} onClick={() => startDM(person.email)}>
            <span className="relative shrink-0"><HumanAvatar email={person.email} />{person.online && <span className="absolute bottom-0 right-0 size-1.5 rounded-full bg-success ring-1 ring-sidebar" />}</span>
            {showLabels && <span className="flex min-w-0 items-center gap-1"><span className="truncate" data-truncatable>{person.name}</span>{person.email === currentUser.id.toLowerCase() && <span className="shrink-0 text-xs text-muted-foreground">({t('threads.you')})</span>}</span>}
            <DmUnreadBadge count={person.unread} compact={!showLabels} />
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
        {team.length > 0 && <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setOpen(true); }} className={cn('mt-1 w-full text-muted-foreground', showLabels ? 'justify-between' : 'justify-center')} title={t('nav.viewAllMembers')} aria-label={t('nav.viewAllMembers')}>
          {showLabels && <span className="truncate">{moreCount > 0 ? t('nav.moreMembers', { count: moreCount }) : t('nav.viewAllMembers')}</span>}<ChevronRight />
        </Button>}
        {/* Inviting, also spelled out at the end of the list. Permissions are
            enforced by the members page and the invite endpoint. */}
        {workspace?.slug && <Button variant="outline" size="sm" onClick={openInvite} className="mt-1 w-full" title={t('userMenu.inviteMembers')} aria-label={t('userMenu.inviteMembers')}>
          <UserPlus data-icon={showLabels ? 'inline-start' : undefined} />{showLabels && t('userMenu.inviteMembers')}
        </Button>}
      </SidebarGroupContent>
    </SidebarGroup>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{t('nav.members')} · {team.length}</DialogTitle></DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <Input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('nav.searchMembers')} />
        <div className="max-h-80 overflow-y-auto">
          {candidates.map(person => <Item key={person.email} size="sm" asChild>
            <button type="button" className="text-left hover:bg-muted" onClick={() => startDM(person.email)}>
              <ItemMedia className="relative"><HumanAvatar email={person.email} />{(online.has(person.email.toLowerCase()) || person.email.toLowerCase() === currentUser.id.toLowerCase()) && <span className="absolute right-0 bottom-0 size-1.5 rounded-full bg-success ring-1 ring-background" aria-label={t('agents.online')} />}</ItemMedia>
              <ItemContent className="min-w-0 gap-0">
                <ItemTitle className="max-w-full truncate">{memberLabel(person.email, person.displayName || (person.email.toLowerCase() === currentUser.id.toLowerCase() ? currentUser.name : '') || person.email)}</ItemTitle>
                {person.displayName && <ItemDescription className="truncate text-xs">{person.email}</ItemDescription>}
              </ItemContent>
            </button>
          </Item>)}
          {!candidates.length && <p className="p-2 text-sm text-muted-foreground">{t('nav.noMembersFound')}</p>}
        </div>
      </DialogBody>
    </DialogContent></Dialog>
  </>;
}
