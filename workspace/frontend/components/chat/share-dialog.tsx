'use client';

// v1.1 M2: the share dialog offers three explicit actions — a read-only
// snapshot (the original flow), inviting a teammate into the thread, and
// letting a teammate use one of the thread's agents. The two interactive
// actions show a sharing preview first so it's clear what becomes visible.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Bot, Check, Copy, FileText, Link, Loader2, Lock, Mail, UserPlus, Users, X,
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
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { shareOrigin } from '@/lib/share-origin';
import { cn } from '@/lib/utils';
import { displayNameFromEmail } from '@/lib/collab';
import type { AgentDirectoryEntry, ChannelParticipants, SharePreview } from '@/lib/types';

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

  // ── Preview (shared by invite + agent) ──
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    if (!open || (mode !== 'invite' && mode !== 'agent') || preview) return;
    let cancelled = false;
    workspaceApi.getSharePreview(sessionId)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch(() => { if (!cancelled) setPreviewFailed(true); });
    return () => { cancelled = true; };
  }, [open, mode, preview, sessionId]);

  // ── Invite a teammate into the thread ──
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

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);

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
      setPreview(null); // people changed — refetch on next look
    } catch {
      toast.error(t('collab.inviteFailed', { email }));
    } finally {
      setInviting(false);
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

  // ── Let a teammate use an agent from this thread ──
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
  const [grantEmail, setGrantEmail] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantLink, setGrantLink] = useState<{ email: string; url: string } | null>(null);

  const grant = async () => {
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
    setInviteEmail('');
    setInviteNote('');
    setInviteLink(null);
    setDirectory(null);
    setAgentName('');
    setGrantEmail('');
    setGrantLink(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const selectedAgent = shareableAgents.find((a) => a.agent_name === agentName);
  const selectedAgentLabel = selectedAgent?.display_name?.trim() || selectedAgent?.agent_name || '';

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
                  <Lock className="size-3" /> {t('collab.privateThreadHint')}
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
              <PreviewBlock preview={preview} failed={previewFailed} />

              <div className="space-y-1.5">
                <Label variant="secondary">{t('collab.currentParticipants')}</Label>
                {participants === null ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : participants.humans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('collab.noParticipants')}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {participants.humans.map((h) => (
                      <li key={h.email} className="flex items-center gap-2 px-3 py-1.5">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                          {(h.display_name || h.email)[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{h.display_name || displayNameFromEmail(h.email)}</p>
                          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            <span className="truncate">{h.email}</span>
                            {participants.director_email?.toLowerCase() === h.email.toLowerCase() && (
                              <Badge variant="outline" size="xs" className="shrink-0">{t('collab.director')}</Badge>
                            )}
                          </p>
                        </div>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => removeParticipant(h.email)} title={t('collab.removeParticipant')}>
                          <X className="size-3.5 text-muted-foreground" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <Label variant="secondary">{t('collab.emailLabel')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder={t('collab.emailPlaceholder')}
                    onKeyDown={(e) => { if (e.key === 'Enter') invite(); }}
                    className="flex-1"
                  />
                  <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
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
            <>
              <PreviewBlock preview={preview} failed={previewFailed} />
              {directory === null ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : shareableAgents.length === 0 ? (
                <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{t('collab.noManageableAgents')}</p>
              ) : (
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
                  <Label variant="secondary">{t('collab.emailLabel')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={grantEmail}
                      onChange={(e) => setGrantEmail(e.target.value)}
                      placeholder={t('collab.emailPlaceholder')}
                      onKeyDown={(e) => { if (e.key === 'Enter') grant(); }}
                      className="flex-1"
                    />
                    <Button onClick={grant} disabled={granting || !grantEmail.trim() || !agentName}>
                      {granting ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                      {granting ? t('collab.granting') : t('collab.grantButton')}
                    </Button>
                  </div>
                  {grantLink && (
                    <InviteLinkBox text={t('collab.grantLinkReady', { email: grantLink.email, agent: selectedAgentLabel })} url={grantLink.url} />
                  )}
                </div>
              )}
            </>
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
