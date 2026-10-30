'use client';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { roleLabel } from '@/lib/roles';
import { HumanAvatar } from './human-avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/responsive-dialog';

export function HumanProfile({ email, onClose }: { email: string | null; onClose: () => void }) {
  const team = useTeamRoster();
  const { onlineUsers } = useWorkspace();
  const t = useT();
  const person = team.find(member => member.email.toLowerCase() === email?.toLowerCase());
  const online = onlineUsers.some(user => user.id.replace(/^human:/, '').toLowerCase() === email?.toLowerCase());
  return <Dialog open={!!email} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle className="flex items-center gap-3">{email && <HumanAvatar email={email} />}{person?.displayName || email}</DialogTitle></DialogHeader>
      <DialogBody className="space-y-3 text-sm">
        <p className="break-all text-muted-foreground">{email}</p>
        {person && <p>{roleLabel(t, person.role)}</p>}
        {online && <p className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" />{t('nav.memberOnline')}</p>}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}
