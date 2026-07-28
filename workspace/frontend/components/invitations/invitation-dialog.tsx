'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPlus, Copy, Check, Clock, CheckCircle, XCircle } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/helpers';
import type { WorkspaceInvitation } from '@/lib/types';

export function InvitationDialog() {
  const [open, setOpen] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [creating, setCreating] = useState(false);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const { copyToClipboard } = useCopyToClipboard();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const loadInvitations = async () => {
    setLoading(true);
    try {
      const list = await workspaceApi.listInvitations();
      setInvitations(list);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadInvitations();
    }
  }, [open]);

  const handleCreate = async () => {
    if (!agentName.trim()) return;
    setCreating(true);
    try {
      await workspaceApi.createInvitation(agentName.trim());
      toast.success(`Invitation sent to ${agentName.trim()}`);
      setAgentName('');
      loadInvitations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create invitation');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyToken = (token: string) => {
    copyToClipboard(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="size-3.5 text-amber-500" />;
      case 'accepted':
        return <CheckCircle className="size-3.5 text-green-500" />;
      case 'rejected':
        return <XCircle className="size-3.5 text-destructive" />;
      case 'expired':
        return <Clock className="size-3.5 text-muted-foreground" />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" mode="icon" size="sm" title="Invite agent">
          <UserPlus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Agent</DialogTitle>
          <DialogDescription>
            Invite an agent that is already registered on the platform to join this workspace.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 py-1">
          {/* Create invitation */}
          <div className="space-y-2">
            <Label>Agent Name</Label>
            <div className="flex items-center gap-2">
              <Input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. claude-abc123"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
              <Button onClick={handleCreate} disabled={creating || !agentName.trim()}>
                {creating ? 'Inviting...' : 'Invite'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              After inviting, use the invite token to connect the agent.
            </p>
          </div>

          {/* Invitations list */}
          {loading && invitations.length === 0 && (
            <p className="text-xs text-muted-foreground">Loading invitations…</p>
          )}

          {invitations.length > 0 && (
            <div className="space-y-2">
              <Label variant="secondary">Invitations</Label>
              {/* No inner scroll region — DialogBody is the only scroll area. */}
              <div className="space-y-2">
                {invitations.map((inv) => (
                  <div
                    key={inv.invitationId}
                    className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-muted/30"
                  >
                    {statusIcon(inv.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{inv.targetAgentName}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.status} {inv.createdAt && `\u00b7 ${timeAgo(inv.createdAt)}`}
                      </p>
                    </div>
                    {inv.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleCopyToken(inv.inviteToken)}
                        title="Copy invite token"
                      >
                        {copiedToken === inv.inviteToken
                          ? <Check className="size-3.5" />
                          : <Copy className="size-3.5" />
                        }
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
