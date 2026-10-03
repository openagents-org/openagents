'use client';

// v1.1 M2: the share dialog offers three explicit actions — a read-only
// snapshot (the original flow), inviting into the thread, and letting others
// use one of the thread's agents. v1.1 permission model: the two interactive
// actions take people, agents AND security groups through the GranteePicker,
// show what becomes accessible (GET /grants/preview) before confirming, list
// who already has access (with revoke) and, for agent grants, take an
// optional expiry. Inviting a non-member by email is still possible.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Bot, Check, Copy, FileText, Link, Loader2, Lock, Mail, Share2, UserPlus, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/responsive-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { GranteeChip, GranteePicker } from '@/components/sharing/grantee-picker';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useFormatters, useT } from '@/lib/i18n';
import { shareOrigin } from '@/lib/share-origin';
import { cn } from '@/lib/utils';
import { displayNameFromEmail } from '@/lib/collab';
import {
  expiryDateToIso,
  granteeChipLabel,
  granteeFromGrant,
  granteeKey,
  isGrantExpired,
} from '@/lib/access-ui';
import type {
  AgentDirectoryEntry,
  ChannelParticipants,
  Grantee,
  GrantPreviewItem,
  ResourceGrant,
  ResourceKind,
  SharePreview,
} from '@/lib/types';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
}

type Mode = 'menu' | 'snapshot' | 'invite' | 'agent';

export function ShareDialog({ open, onOpenChange, sessionId }: ShareDialogProps) {
  const t = useT();
  const { sessions } = useWorkspace();
  const session = sessions.find((s) => s.sessionId === sessionId);
  const [mode, setMode] = useState<Mode>('menu');

  // ── Snapshot (original flow) ──
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const handleCreateShare = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await workspaceApi.createShare(sessionId);
      setShareUrl(`${shareOrigin()}/share/${result.shareToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('share.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  // ── Thread content preview (what a newcomer sees) ──
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    if (!open || mode !== 'invite' || preview) return;
    let cancelled = false;
    workspaceApi.getSharePreview(sessionId)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch(() => { if (!cancelled) setPreviewFailed(true); });
    return () => { cancelled = true; };
  }, [open, mode, preview, sessionId]);

  // ── Invite into the thread ──
  const [participants, setParticipants] = useState<ChannelParticipants | null>(null);
  const loadParticipants = useCallback(async () => {
    try {
      setParticipants(await workspaceApi.getChannelParticipants(sessionId));
    } catch {
      toast.error(t('collab.participantsLoadFailed'));
    }
  }, [sessionId, t]);
  useEffect(() => {
    if (open && mode === 'invite' && !participants) loadParticipants();
  }, [open, mode, participants, loadParticipants]);

  const [threadGrants, setThreadGrants] = useState<ResourceGrant[] | null>(null);
  const loadThreadGrants = useCallback(async () => {
    try {
      setThreadGrants(await workspaceApi.listGrants('channel', sessionId));
    } catch {
      setThreadGrants([]);
    }
  }, [sessionId]);
  useEffect(() => {
    if (open && mode === 'invite' && !threadGrants) loadThreadGrants();
  }, [open, mode, threadGrants, loadThreadGrants]);

  const [threadPicks, setThreadPicks] = useState<Grantee[]>([]);
  const [sharingThread, setSharingThread] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);

  const threadExclude = useMemo(() => [
    ...(participants?.humans.map((h) => `human:${h.email.toLowerCase()}`) || []),
    ...(threadGrants || []).map((g) => granteeKey({ kind: g.grantee_kind, id: g.grantee_id })),
  ], [participants, threadGrants]);

  // People go through the participants endpoint (it also handles non-members
  // with an invite link); agents and groups become channel grants.
  const shareThread = async () => {
    if (threadPicks.length === 0 || sharingThread) return;
    setSharingThread(true);
    setInviteLink(null);
    let done = 0;
    for (const g of threadPicks) {
      try {
        if (g.kind === 'human') {
          const res = await workspaceApi.inviteHumanToChannel(sessionId, g.id);
          if (!res.added) setInviteLink({ email: g.id, url: res.invite_url });
        } else {
          await workspaceApi.createGrant({ resource_kind: 'channel', resource_id: sessionId, grantee_kind: g.kind, grantee_id: g.id });
        }
        done += 1;
      } catch {
        toast.error(t('threadAccess.shareFailed', { name: granteeChipLabel(g) }));
      }
    }
    setSharingThread(false);
    setThreadPicks([]);
    if (done > 0) {
      toast.success(t('threadAccess.shared', { count: done }));
      setPreview(null);
      await Promise.all([loadParticipants(), loadThreadGrants()]);
    }
  };

  const removeParticipant = async (email: string) => {
    setParticipants((prev) => prev ? { ...prev, humans: prev.humans.filter((h) => h.email !== email) } : prev);
    try {
      await workspaceApi.removeHumanFromChannel(sessionId, email);
      toast.success(t('collab.participantRemoved', { email }));
      setPreview(null);
    } catch {
      toast.error(t('collab.removeFailed', { email }));
      loadParticipants();
    }
  };

  const revokeThreadGrant = async (grant: ResourceGrant) => {
    setThreadGrants((prev) => prev?.filter((g) => g.id !== grant.id) ?? prev);
    try {
      await workspaceApi.revokeGrant(grant.id);
      toast.success(t('threadAccess.revoked', { name: granteeChipLabel(granteeFromGrant(grant)) }));
      setPreview(null);
    } catch {
      toast.error(t('threadAccess.revokeFailed'));
      loadThreadGrants();
    }
  };

  // Email path for someone who is not a member yet.
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [inviting, setInviting] = useState(false);

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviting) return;
    setInviting(true);
    setInviteLink(null);
    try {
      const res = await workspaceApi.inviteHumanToChannel(sessionId, email, inviteNote.trim() || undefined);
      if (res.added) {
        toast.success(t('collab.addedToThread', { email: res.email }));
      } else {
        setInviteLink({ email, url: res.invite_url });
      }
      setInviteEmail('');
      setInviteNote('');
      await loadParticipants();
      setPreview(null);
    } catch {
      toast.error(t('collab.inviteFailed', { email }));
    } finally {
      setInviting(false);
    }
  };

  // ── Let others use an agent from this thread ──
  const [directory, setDirectory] = useState<AgentDirectoryEntry[] | null>(null);
  useEffect(() => {
    if (!open || mode !== 'agent' || directory) return;
    let cancelled = false;
    workspaceApi.getAgentDirectory()
      .then((d) => { if (!cancelled) setDirectory(d); })
      .catch(() => { if (!cancelled) setDirectory([]); });
    return () => { cancelled = true; };
  }, [open, mode, directory]);

  const shareableAgents = useMemo(() => {
    const inThread = new Set(session?.participants || []);
    return (directory || []).filter((a) => a.can_manage && inThread.has(a.agent_name));
  }, [directory, session?.participants]);

  const [agentName, setAgentName] = useState<string>('');
  useEffect(() => {
    if (!agentName && shareableAgents.length > 0) setAgentName(shareableAgents[0].agent_name);
  }, [agentName, shareableAgents]);

  const [agentGrants, setAgentGrants] = useState<ResourceGrant[] | null>(null);
  const loadAgentGrants = useCallback(async (name: string) => {
    try {
      setAgentGrants(await workspaceApi.listGrants('agent', name));
    } catch {
      setAgentGrants([]);
    }
  }, []);
  useEffect(() => {
    if (!open || mode !== 'agent' || !agentName) return;
    setAgentGrants(null);
    loadAgentGrants(agentName);
  }, [open, mode, agentName, loadAgentGrants]);

  const [agentPicks, setAgentPicks] = useState<Grantee[]>([]);
  const [expiry, setExpiry] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantLink, setGrantLink] = useState<{ email: string; url: string } | null>(null);
  const [grantEmail, setGrantEmail] = useState('');

  const agentExclude = useMemo(
    () => (agentGrants || []).map((g) => granteeKey({ kind: g.grantee_kind, id: g.grantee_id })),
    [agentGrants],
  );

  const selectedAgent = shareableAgents.find((a) => a.agent_name === agentName);
  const selectedAgentLabel = selectedAgent?.display_name?.trim() || selectedAgent?.agent_name || '';

  const shareAgent = async () => {
    if (!agentName || agentPicks.length === 0 || granting) return;
    setGranting(true);
    const expires_at = expiryDateToIso(expiry);
    let done = 0;
    for (const g of agentPicks) {
      try {
        await workspaceApi.createGrant({
          resource_kind: 'agent',
          resource_id: agentName,
          grantee_kind: g.kind,
          grantee_id: g.id,
          ...(expires_at ? { expires_at } : {}),
        });
        done += 1;
      } catch {
        toast.error(t('threadAccess.shareFailed', { name: granteeChipLabel(g) }));
      }
    }
    setGranting(false);
    setAgentPicks([]);
    if (done > 0) {
      toast.success(t('threadAccess.shared', { count: done }));
      await loadAgentGrants(agentName);
    }
  };

  const revokeAgentGrant = async (grant: ResourceGrant) => {
    setAgentGrants((prev) => prev?.filter((g) => g.id !== grant.id) ?? prev);
    try {
      await workspaceApi.revokeGrant(grant.id);
      toast.success(t('threadAccess.revoked', { name: granteeChipLabel(granteeFromGrant(grant)) }));
    } catch {
      toast.error(t('threadAccess.revokeFailed'));
      loadAgentGrants(agentName);
    }
  };

  // Email path (legacy shim: a non-member gets an invite link back).
  const grantByEmail = async () => {
    const email = grantEmail.trim().toLowerCase();
    const agent = shareableAgents.find((a) => a.agent_name === agentName);
    if (!email || !agent || granting) return;
    const label = agent.display_name?.trim() || agent.agent_name;
    setGranting(true);
    setGrantLink(null);
    try {
      const res = await workspaceApi.grantAgent(agent.agent_name, email);
      if (res.granted) {
        toast.success(t('collab.granted', { email, agent: label }));
        await loadAgentGrants(agent.agent_name);
      } else {
        setGrantLink({ email, url: res.invite_url });
      }
      setGrantEmail('');
    } catch {
      toast.error(t('collab.grantFailed', { email, agent: label }));
    } finally {
      setGranting(false);
    }
  };

  const reset = () => {
    setMode('menu');
    setShareUrl(null);
    setError(null);
    setLoading(false);
    setPreview(null);
    setPreviewFailed(false);
    setParticipants(null);
    setThreadGrants(null);
    setThreadPicks([]);
    setInviteEmail('');
    setInviteNote('');
    setInviteLink(null);
    setDirectory(null);
    setAgentName('');
    setAgentGrants(null);
    setAgentPicks([]);
    setExpiry('');
    setGrantEmail('');
    setGrantLink(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const ownerEmail = (participants?.owner_email || participants?.director_email || session?.ownerEmail || session?.directorEmail || '').toLowerCase();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-3 px-7 pt-7 pb-2">
          <DialogTitle className="text-xl">
            {mode === 'menu' ? t('collab.shareTitle')
              : mode === 'snapshot' ? t('share.title')
                : mode === 'invite' ? t('collab.shareInvite')
                  : t('collab.shareAgent')}
          </DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {mode === 'menu' ? t('collab.shareDescription')
              : mode === 'snapshot' ? t('share.description')
                : t('collab.snapshotVsInteractive')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 px-7 py-2">
          {/* ── Menu ── */}
          {mode === 'menu' && (
            <div className="space-y-2">
              <ShareOption icon={<Link className="size-4" />} title={t('collab.shareSnapshot')} hint={t('collab.shareSnapshotHint')} onClick={() => setMode('snapshot')} />
              <ShareOption icon={<UserPlus className="size-4" />} title={t('collab.shareInvite')} hint={t('collab.shareInviteHint')} onClick={() => setMode('invite')} />
              <ShareOption icon={<Bot className="size-4" />} title={t('collab.shareAgent')} hint={t('collab.shareAgentHint')} onClick={() => setMode('agent')} />
              {session?.visibility === 'private' && (
                <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                  <Lock className="size-3" /> {t('threadAccess.privateHint')}
                </p>
              )}
            </div>
          )}

          {/* ── Snapshot ── */}
          {mode === 'snapshot' && (
            shareUrl ? (
              <div className="space-y-2">
                <Label variant="secondary">{t('share.shareLink')}</Label>
                <Input readOnly value={shareUrl} className="font-mono select-all" onFocus={(e) => e.target.select()} />
              </div>
            ) : (
              <div className="rounded-md border border-input bg-muted/40 px-4 py-3.5">
                <p className="text-sm leading-relaxed text-muted-foreground">{t('share.snapshotNote')}</p>
              </div>
            )
          )}
          {mode === 'snapshot' && error && <p className="text-sm text-destructive">{error}</p>}

          {/* ── Invite into thread ── */}
          {mode === 'invite' && (
            <>
              {threadPicks.length > 0
                ? <GrantPreviewBlock resourceKind="channel" resourceId={sessionId} grantees={threadPicks} />
                : <PreviewBlock preview={preview} failed={previewFailed} />}

              <div className="space-y-2">
                <Label variant="secondary">{t('threadAccess.shareWith')}</Label>
                <GranteePicker value={threadPicks} onChange={setThreadPicks} exclude={threadExclude} />
                {threadPicks.length > 0 && (
                  <Button onClick={shareThread} disabled={sharingThread}>
                    {sharingThread ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
                    {sharingThread ? t('threadAccess.sharing') : t('threadAccess.shareButton')}
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <Label variant="secondary">{t('threadAccess.existingGrants')}</Label>
                {participants === null ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : participants.humans.length === 0 && (threadGrants?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('threadAccess.noGrants')}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {participants.humans.map((h) => {
                      const isOwner = ownerEmail === h.email.toLowerCase();
                      return (
                        <li key={h.email} className="flex items-center gap-2 px-3 py-1.5">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                            {(h.display_name || h.email)[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{h.display_name || displayNameFromEmail(h.email)}</p>
                            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                              <span className="truncate">{h.email}</span>
                              {isOwner && <Badge variant="outline" size="xs" className="shrink-0">{t('threadAccess.ownerBadge')}</Badge>}
                            </p>
                          </div>
                          {!isOwner && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => removeParticipant(h.email)} title={t('collab.removeParticipant')}>
                              <X className="size-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                    {(threadGrants || []).map((g) => (
                      <GrantRow key={g.id} grant={g} onRevoke={() => revokeThreadGrant(g)} />
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <Label variant="secondary">{t('threadAccess.orInviteByEmail')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder={t('collab.emailPlaceholder')}
                    onKeyDown={(e) => { if (e.key === 'Enter') invite(); }}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                    {inviting ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                    {inviting ? t('collab.inviting') : t('collab.inviteButton')}
                  </Button>
                </div>
                <Input value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} placeholder={t('collab.notePlaceholder')} maxLength={200} />
                {inviteLink && <InviteLinkBox text={t('collab.inviteLinkReady', { email: inviteLink.email })} url={inviteLink.url} />}
              </div>
            </>
          )}

          {/* ── Share an agent ── */}
          {mode === 'agent' && (
            directory === null ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : shareableAgents.length === 0 ? (
              <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{t('collab.noManageableAgents')}</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label variant="secondary">{t('collab.pickAgent')}</Label>
                  <Select value={agentName} onValueChange={setAgentName}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {shareableAgents.map((a) => (
                        <SelectItem key={a.agent_name} value={a.agent_name}>
                          <span className="flex items-center gap-2">
                            <AgentAvatar name={a.agent_name} size={18} />
                            {a.display_name?.trim() || a.agent_name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {agentPicks.length > 0 && agentName && (
                  <GrantPreviewBlock resourceKind="agent" resourceId={agentName} grantees={agentPicks} />
                )}

                <div className="space-y-2">
                  <Label variant="secondary">{t('threadAccess.shareWith')}</Label>
                  <GranteePicker value={agentPicks} onChange={setAgentPicks} exclude={agentExclude} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Label variant="secondary" className="shrink-0">{t('threadAccess.expiry')}</Label>
                    <Input
                      type="date"
                      value={expiry}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setExpiry(e.target.value)}
                      className="h-8 w-44 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">{t('threadAccess.expiryHint')}</span>
                  </div>
                  {agentPicks.length > 0 && (
                    <Button onClick={shareAgent} disabled={granting}>
                      {granting ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
                      {granting ? t('threadAccess.sharing') : t('threadAccess.shareButton')}
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label variant="secondary">{t('threadAccess.existingGrants')}</Label>
                  {agentGrants === null ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : agentGrants.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('threadAccess.noGrants')}</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {agentGrants.map((g) => (
                        <GrantRow key={g.id} grant={g} onRevoke={() => revokeAgentGrant(g)} />
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <Label variant="secondary">{t('threadAccess.orInviteByEmail')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={grantEmail}
                      onChange={(e) => setGrantEmail(e.target.value)}
                      placeholder={t('collab.emailPlaceholder')}
                      onKeyDown={(e) => { if (e.key === 'Enter') grantByEmail(); }}
                      className="flex-1"
                    />
                    <Button variant="outline" onClick={grantByEmail} disabled={granting || !grantEmail.trim() || !agentName}>
                      {granting ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                      {granting ? t('collab.granting') : t('collab.grantButton')}
                    </Button>
                  </div>
                  {grantLink && (
                    <InviteLinkBox text={t('collab.grantLinkReady', { email: grantLink.email, agent: selectedAgentLabel })} url={grantLink.url} />
                  )}
                </div>
              </>
            )
          )}
        </DialogBody>

        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          {mode === 'menu' ? (
            <Button variant="outline" className="min-w-24" onClick={() => handleOpenChange(false)}>
              {t('common.cancel')}
            </Button>
          ) : (
            <Button variant="outline" className="min-w-24" onClick={() => { setMode('menu'); setShareUrl(null); setError(null); }} disabled={loading}>
              <ArrowLeft />
              {t('collab.back')}
            </Button>
          )}
          {mode === 'snapshot' && (
            shareUrl ? (
              <Button className="min-w-24" onClick={() => copyToClipboard(shareUrl)}>
                {isCopied ? <Check /> : <Copy />}
                {isCopied ? t('common.copied') : t('share.copyLink')}
              </Button>
            ) : (
              <Button className="min-w-24" onClick={handleCreateShare} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Link />}
                {loading ? t('share.creating') : error ? t('share.tryAgain') : t('share.createLink')}
              </Button>
            )
          )}
          {(mode === 'invite' || mode === 'agent') && (
            <Button className="min-w-24" onClick={() => handleOpenChange(false)}>
              {t('common.done')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function ShareOption({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-muted/60"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function PreviewBlock({ preview, failed }: { preview: SharePreview | null; failed: boolean }) {
  const t = useT();
  return (
    <div className="rounded-md border border-input bg-muted/40 px-4 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('collab.previewTitle')}</p>
      {failed ? (
        <p className="text-sm text-destructive">{t('collab.previewFailed')}</p>
      ) : !preview ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t('collab.previewLoading')}
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="flex items-center gap-1.5 text-muted-foreground"><Users className="size-3.5" />{t('collab.previewPeople')}</dt>
          <dd className="min-w-0 truncate">{preview.humans.length ? preview.humans.map(displayNameFromEmail).join(', ') : t('collab.previewNone')}</dd>
          <dt className="flex items-center gap-1.5 text-muted-foreground"><Bot className="size-3.5" />{t('collab.previewAgents')}</dt>
          <dd className="min-w-0 truncate">{preview.agents.length ? preview.agents.join(', ') : t('collab.previewNone')}</dd>
          <dt className="flex items-center gap-1.5 text-muted-foreground"><FileText className="size-3.5" />{t('collab.previewFiles', { count: preview.files.length })}</dt>
          <dd className={cn('min-w-0 truncate', !preview.files.length && 'text-muted-foreground')}>
            {preview.files.length ? preview.files.slice(0, 3).map((f) => f.filename).join(', ') + (preview.files.length > 3 ? '…' : '') : t('collab.previewNone')}
          </dd>
          <dt className="text-muted-foreground">{t('collab.previewMessages', { count: preview.message_count })}</dt>
          <dd className="text-muted-foreground">{t('collab.previewKnowledge', { count: preview.knowledge_refs.length })}</dd>
        </dl>
      )}
    </div>
  );
}

const PREVIEW_MAX = 6;

/** GET /grants/preview for every picked grantee, merged and de-duplicated —
 * exactly what the selection would gain if confirmed. */
function GrantPreviewBlock({ resourceKind, resourceId, grantees }: { resourceKind: ResourceKind; resourceId: string; grantees: Grantee[] }) {
  const t = useT();
  const [items, setItems] = useState<GrantPreviewItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const keys = grantees.map(granteeKey).join('|');

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setFailed(false);
    Promise.all(grantees.map((g) => workspaceApi.previewGrant(resourceKind, resourceId, g.kind, g.id)))
      .then((previews) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const merged: GrantPreviewItem[] = [];
        for (const p of previews) {
          for (const it of p.items) {
            const k = `${it.kind}:${it.id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(it);
          }
        }
        setItems(merged);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceKind, resourceId, keys]);

  return (
    <div className="rounded-md border border-input bg-muted/40 px-4 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('threadAccess.previewTitle')}</p>
      {failed ? (
        <p className="text-sm text-destructive">{t('threadAccess.previewFailed')}</p>
      ) : items === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t('threadAccess.previewLoading')}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('threadAccess.previewEmpty')}</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {items.slice(0, PREVIEW_MAX).map((it) => (
            <li key={`${it.kind}:${it.id}`} className="flex min-w-0 items-center gap-2">
              <Badge variant="outline" size="xs" className="shrink-0 capitalize">{it.kind}</Badge>
              <span className="truncate">{it.title || it.id}</span>
            </li>
          ))}
          {items.length > PREVIEW_MAX && (
            <li className="text-xs text-muted-foreground">{t('threadAccess.previewMore', { count: items.length - PREVIEW_MAX })}</li>
          )}
        </ul>
      )}
    </div>
  );
}

function GrantRow({ grant, onRevoke }: { grant: ResourceGrant; onRevoke: () => void }) {
  const t = useT();
  const { formatDate } = useFormatters();
  const expired = isGrantExpired(grant);
  return (
    <li className="flex items-center gap-2 px-3 py-1.5">
      <GranteeChip grantee={granteeFromGrant(grant)} muted={expired} />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {grant.expires_at
          ? (expired ? t('threadAccess.expired') : t('threadAccess.expiresOn', { date: formatDate(grant.expires_at) }))
          : grant.granted_by ? displayNameFromEmail(grant.granted_by) : ''}
      </span>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={onRevoke}>
        {t('threadAccess.revoke')}
      </Button>
    </li>
  );
}

function InviteLinkBox({ text, url }: { text: string; url: string }) {
  const t = useT();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{text}</p>
      <div className="flex items-center gap-2">
        <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button size="sm" variant="outline" onClick={() => copyToClipboard(url)}>
          {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {isCopied ? t('common.copied') : t('collab.copyLink')}
        </Button>
      </div>
    </div>
  );
}
