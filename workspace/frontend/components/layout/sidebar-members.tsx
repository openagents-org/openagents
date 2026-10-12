'use client';
import { DmUnreadBadge } from './dm-unread-badge';
import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';
import { dmSessionId, myAddress } from '@/lib/dm';
import { sidebarMembers } from '@/lib/sidebar-members';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/responsive-dialog';
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export function SidebarMembers({ showLabels, onNavigate }: { showLabels: boolean; onNavigate?: () => void }) {
  const t = useT();
  const team = useTeamRoster();
  const { currentUser, onlineUsers, dmConversations, unreadDmCounts, setCurrentSessionId, currentSessionId } = useWorkspace();
  const { openView, openMobileDetail, setSelectedAgentName, setThreadFilter } = useLayout();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const me = myAddress(currentUser);
  const members = sidebarMembers(team, onlineUsers, dmConversations, me, currentUser.name);
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
          <SidebarMenuButton className={cn(!showLabels && 'justify-center!', !person.hasHistory && 'text-muted-foreground opacity-55')} aria-label={person.email === currentUser.id.toLowerCase() ? t('threads.you') : person.name} tooltip={{ children: person.email === currentUser.id.toLowerCase() ? t('threads.you') : person.name, hidden: showLabels }} isActive={currentSessionId === dmSessionId(me, `human:${person.email}`)} onClick={() => startDM(person.email)}>
            <span className="relative shrink-0"><HumanAvatar email={person.email} />{person.online && <span className="absolute bottom-0 right-0 size-1.5 rounded-full bg-emerald-500 ring-1 ring-sidebar" />}</span>
            {showLabels && <span className="truncate">{person.email === currentUser.id.toLowerCase() ? t('threads.you') : person.name}</span>}
            <DmUnreadBadge count={unreadDmCounts[dmSessionId(me, `human:${person.email}`)]} compact={!showLabels} />
          </SidebarMenuButton>
        </SidebarMenuItem>)}
      </SidebarMenu></SidebarGroupContent>
    </SidebarGroup>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{t('nav.newHumanDM')}</DialogTitle></DialogHeader>
      <DialogBody className="space-y-3">
        <Input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('nav.searchMembers')} />
        <div className="max-h-80 overflow-y-auto">
          {candidates.map(person => <button key={person.email} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted" onClick={() => startDM(person.email)}>
            <HumanAvatar email={person.email} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{person.email.toLowerCase() === currentUser.id.toLowerCase() ? t('threads.you') : person.displayName || person.email}</span>{person.displayName && <span className="block truncate text-xs text-muted-foreground">{person.email}</span>}</span>
          </button>)}
          {!candidates.length && <p className="p-2 text-sm text-muted-foreground">{t('nav.noMembersFound')}</p>}
        </div>
      </DialogBody>
    </DialogContent></Dialog>
  </>;
}
