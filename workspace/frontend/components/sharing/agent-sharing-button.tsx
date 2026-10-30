'use client';
import { useState } from 'react';
import { Users } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useMe } from '@/hooks/use-me';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogBody, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/responsive-dialog';
import { AgentAccessSection } from './agent-access-section';

export function AgentSharingButton({ agentName }: { agentName: string }) {
  const { workspace, agents, refreshWorkspace } = useWorkspace();
  const me = useMe(workspace?.workspaceId);
  const t = useT();
  const [open, setOpen] = useState(false);
  const agent = agents.find(item => item.agentName === agentName);
  if (agent?.builtin || !me?.email || agent?.ownerEmail?.toLowerCase() !== me.email.toLowerCase()) return null;
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Users className="size-3.5" />{t('services.agentSharing')}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent><DialogHeader><DialogTitle>{t('services.agentSharing')} · {agent.displayName || agentName}</DialogTitle><DialogDescription>{t('services.agentSharingHint')}</DialogDescription></DialogHeader>
        <DialogBody><AgentAccessSection key={agentName} agentName={agentName} displayName={agent.displayName || undefined} onChanged={() => void refreshWorkspace()} /></DialogBody>
      </DialogContent>
    </Dialog>
  </>;
}
