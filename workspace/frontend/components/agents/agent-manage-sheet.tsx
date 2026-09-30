'use client';

// ── v1.1 M2/M4 — "Manage" drawer for an agent the caller owns / administers ──
// Profile editor (purpose, example requests, required inputs, cost owner,
// visibility, owner) via PATCH members, the specialist scope teammates'
// requests run under (shared instructions + allowed knowledge) with a
// "what teammates see" preview and a test request, proposals from teammates
// (kind=proposal approvals) to accept or decline, plus the grants list (who
// may use the agent) with add / revoke.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, CheckSquare, Copy, Loader2, Play, Plus, Square, UserMinus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useLayout } from '@/components/layout/layout-context';
import { prefillComposer } from '@/components/chat/composer-prefill';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { apiErrorStatus, displayNameFromEmail, linesToList } from '@/lib/collab';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import type {
  AgentDirectoryEntry,
  AgentGrant,
  AgentProfileView,
  AgentVisibility,
  ApprovalRequest,
  CostOwner,
  TeamMember,
} from '@/lib/types';

/** Radix rejects '' as an item value, so "no owner" needs a sentinel. */
const NO_OWNER = '__none__';

/** Teammates see the first N characters of the shared instructions —
 * mirrors `SUMMARY_CHARS` in backend app/routers/agent_profile.py. */
const SUMMARY_CHARS = 240;

/** Same DM id the rail builds: a person's own thread with the agent. */
function dmSessionId(agentName: string): string {
  const pair = ['human:user', `openagents:${agentName}`].sort();
  return `dm:${pair[0]},${pair[1]}`;
}

export function AgentManageSheet({
  entry, open, onOpenChange, onSaved,
}: {
  entry: AgentDirectoryEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const t = useT();
  const name = entry.display_name?.trim() || entry.agent_name;
  const { knowledge, sessions, setCurrentSessionId } = useWorkspace();
  const { openView, isMobile, openMobileDetail } = useLayout();

  // ── Profile ──
  const [purpose, setPurpose] = useState(entry.purpose || '');
  const [examples, setExamples] = useState((entry.example_requests || []).join('\n'));
  const [requiredInputs, setRequiredInputs] = useState(entry.required_inputs || '');
  const [costOwner, setCostOwner] = useState<CostOwner>(entry.cost_owner || 'owner');
  const [visibility, setVisibility] = useState<AgentVisibility>(entry.visibility || 'team');
  const [owner, setOwner] = useState<string>(entry.owner_email || NO_OWNER);
  const [saving, setSaving] = useState(false);

  // ── Specialist scope (v1.1 M4) — only in the owner/admin view of the profile ──
  const [profile, setProfile] = useState<AgentProfileView | null>(null);
  const [sharedInstructions, setSharedInstructions] = useState('');
  const [allowedKnowledge, setAllowedKnowledge] = useState<string[]>([]);
  const loadProfile = useCallback(async () => {
    try {
      const p = await workspaceApi.getAgentProfile(entry.agent_name);
      setProfile(p);
      if (p.can_manage) {
        setSharedInstructions(p.shared_instructions || '');
        setAllowedKnowledge((p.allowed_knowledge || []).map((k) => k.slug));
      }
    } catch {
      toast.error(t('collab.profileLoadFailed'));
    }
  }, [entry.agent_name, t]);
  useEffect(() => { loadProfile(); }, [loadProfile]);
  const canEditScope = !!profile?.can_manage;

  // Knowledge options: the workspace list, plus any allowed slug that has
  // since left the list (so it can still be unticked).
  const knowledgeOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { slug: string; title: string }[] = [];
    for (const k of knowledge) {
      if (seen.has(k.slug)) continue;
      seen.add(k.slug);
      out.push({ slug: k.slug, title: k.title });
    }
    for (const k of profile?.allowed_knowledge || []) {
      if (seen.has(k.slug)) continue;
      seen.add(k.slug);
      out.push({ slug: k.slug, title: k.title || k.slug });
    }
    return out;
  }, [knowledge, profile?.allowed_knowledge]);
  const toggleKnowledge = (slug: string) => {
    setAllowedKnowledge((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  };

  // Owner picker options: the workspace's people (admin-only endpoint — a plain
  // owner falls back to the current owner + themselves).
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    workspaceApi.getTeam()
      .then((team) => { if (!cancelled) setMembers(team); })
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, []);
  const ownerOptions = Array.from(new Set([
    ...(members || []).map((m) => m.email),
    ...(entry.owner_email ? [entry.owner_email] : []),
  ]));
  const ownerName = (email: string) => members?.find((m) => m.email === email)?.displayName || displayNameFromEmail(email);

  const saveProfile = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await workspaceApi.updateAgentProfile(entry.agent_name, {
        purpose: purpose.trim(),
        example_requests: linesToList(examples),
        required_inputs: requiredInputs.trim(),
        cost_owner: costOwner,
        visibility,
        owner_email: owner === NO_OWNER ? '' : owner,
        // The scope fields only travel when we hold the full view — otherwise
        // a stale/blank value would wipe what the owner set.
        ...(canEditScope ? {
          shared_instructions: sharedInstructions.trim(),
          allowed_knowledge: allowedKnowledge,
        } : {}),
      });
      toast.success(t('collab.profileSaved'));
      onSaved?.();
    } catch (e) {
      const status = apiErrorStatus(e);
      toast.error(
        status === 403 ? t('collab.saveForbidden')
          : status === 400 && visibility === 'personal' && owner === NO_OWNER ? t('collab.personalNeedsOwner')
            : t('collab.profileSaveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  // "Run a test request": open your own thread with the agent and hand the
  // composer "@agent <first example>". The composer owns the current thread's
  // draft, so the thread switch has to render before the prefill lands.
  const firstExample = linesToList(examples)[0] || '';
  const runTestRequest = () => {
    if (!firstExample) return;
    const text = `@${entry.agent_name} ${firstExample}`;
    setCurrentSessionId(dmSessionId(entry.agent_name));
    openView('threads');
    if (isMobile) openMobileDetail();
    onOpenChange(false);
    setTimeout(() => prefillComposer(text), 150);
  };

  // ── Proposals (v1.1 M4) — teammates' corrections awaiting the owner ──
  const [proposals, setProposals] = useState<ApprovalRequest[] | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const loadProposals = useCallback(async () => {
    try {
      const { approvals } = await workspaceApi.listApprovals({ status: 'pending', kind: 'proposal', limit: 100 });
      setProposals(approvals.filter((a) => a.kind === 'proposal' && a.requestedBy === entry.agent_name));
    } catch {
      setProposals([]);
      toast.error(t('collab.proposalsLoadFailed'));
    }
  }, [entry.agent_name, t]);
  useEffect(() => { if (canEditScope) loadProposals(); }, [canEditScope, loadProposals]);

  const resolveProposal = async (proposal: ApprovalRequest, decision: 'approve' | 'reject') => {
    if (resolving) return;
    setResolving(proposal.id);
    try {
      await workspaceApi.resolveApproval(proposal.id, decision);
      setProposals((prev) => prev?.filter((p) => p.id !== proposal.id) ?? prev);
      if (decision === 'approve') {
        // Approving appends `details` to shared_instructions server-side —
        // reload so the textarea shows the merged text.
        await loadProfile();
        toast.success(t('collab.proposalAccepted'));
      } else {
        toast.success(t('collab.proposalDeclined'));
      }
      onSaved?.();
    } catch {
      toast.error(t('collab.proposalResolveFailed'));
    } finally {
      setResolving(null);
    }
  };
  const channelTitle = (channel: string) => sessions.find((s) => s.sessionId === channel)?.title?.trim() || channel;

  // ── Grants ──
  const [grants, setGrants] = useState<AgentGrant[] | null>(null);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [granting, setGranting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const loadGrants = useCallback(async () => {
    try {
      setGrants(await workspaceApi.listAgentGrants(entry.agent_name));
    } catch {
      setGrants([]);
      toast.error(t('collab.grantsLoadFailed'));
    }
  }, [entry.agent_name, t]);
  useEffect(() => { loadGrants(); }, [loadGrants]);

  const addGrant = async () => {
    const email = grantEmail.trim().toLowerCase();
    if (!email || granting) return;
    setGranting(true);
    setInviteUrl(null);
    try {
      const res = await workspaceApi.grantAgent(entry.agent_name, email, grantNote.trim() || undefined);
      if (res.granted) {
        toast.success(t('collab.granted', { email, agent: name }));
      } else {
        setInviteUrl(res.invite_url);
      }
      setGrantEmail('');
      setGrantNote('');
      await loadGrants();
      onSaved?.();
    } catch {
      toast.error(t('collab.grantFailed', { agent: name, email }));
    } finally {
      setGranting(false);
    }
  };

  const revoke = async (email: string) => {
    setGrants((prev) => prev?.filter((g) => g.email !== email) ?? prev);
    try {
      await workspaceApi.revokeAgentGrant(entry.agent_name, email);
      toast.success(t('collab.grantRevoked', { email }));
      onSaved?.();
    } catch {
      toast.error(t('collab.grantRevokeFailed'));
      loadGrants();
    }
  };

  // ── Teammate preview — what the directory card / teammate view shows ──
  const previewExamples = linesToList(examples).slice(0, 3);
  const instructionsText = sharedInstructions.trim();
  const instructionsSummary = instructionsText.length > SUMMARY_CHARS
    ? `${instructionsText.slice(0, SUMMARY_CHARS)}…`
    : instructionsText;
  const costOwnerText = costOwner === 'workspace'
    ? t('collab.costOwnerOptionWorkspace')
    : costOwner === 'requester'
      ? t('collab.costOwnerOptionRequester')
      : t('collab.costOwnerOptionOwner');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{t('collab.manageTitle', { agent: name })}</SheetTitle>
          <SheetDescription>{t('collab.manageDescription')}</SheetDescription>
        </SheetHeader>

        <SheetBody className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* Profile */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('collab.profileSection')}</h4>
            <div className="space-y-1.5">
              <Label>{t('collab.purposeLabel')}</Label>
              <Textarea rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('collab.purposePlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('collab.exampleRequestsLabel')}</Label>
              <Textarea rows={3} value={examples} onChange={(e) => setExamples(e.target.value)} placeholder={t('collab.exampleRequestsPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('collab.requiredInputsLabel')}</Label>
              <Textarea rows={2} value={requiredInputs} onChange={(e) => setRequiredInputs(e.target.value)} placeholder={t('collab.requiredInputsPlaceholder')} />
            </div>

            {/* v1.1 M4: the scope teammates' requests run under */}
            {canEditScope && (
              <>
                <div className="space-y-1.5">
                  <Label>{t('collab.sharedInstructionsLabel')}</Label>
                  <Textarea
                    rows={4}
                    value={sharedInstructions}
                    onChange={(e) => setSharedInstructions(e.target.value)}
                    placeholder={t('collab.sharedInstructionsPlaceholder')}
                  />
                  <p className="text-[11px] text-muted-foreground">{t('collab.sharedInstructionsHint')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('collab.allowedKnowledgeLabel')}</Label>
                  {knowledgeOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('collab.allowedKnowledgeEmpty')}</p>
                  ) : (
                    <ul className="max-h-40 divide-y overflow-y-auto rounded-md border" role="listbox" aria-multiselectable>
                      {knowledgeOptions.map((k) => {
                        const selected = allowedKnowledge.includes(k.slug);
                        return (
                          <li key={k.slug}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => toggleKnowledge(k.slug)}
                              className={cn(
                                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                                selected && 'bg-accent/50',
                              )}
                            >
                              {selected
                                ? <CheckSquare className="size-4 shrink-0 text-primary" />
                                : <Square className="size-4 shrink-0 text-muted-foreground" />}
                              <span className="min-w-0 flex-1 truncate">{k.title}</span>
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{k.slug}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {t('collab.allowedKnowledgeHint')}
                    {knowledgeOptions.length > 0 && ` · ${t('collab.allowedKnowledgeSelected', { count: allowedKnowledge.length })}`}
                  </p>
                </div>
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('collab.costOwnerLabel')}</Label>
                <Select value={costOwner} onValueChange={(v) => setCostOwner(v as CostOwner)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">{t('collab.costOwnerOptionOwner')}</SelectItem>
                    <SelectItem value="workspace">{t('collab.costOwnerOptionWorkspace')}</SelectItem>
                    <SelectItem value="requester">{t('collab.costOwnerOptionRequester')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('collab.visibilityLabel')}</Label>
                <Select value={visibility} onValueChange={(v) => setVisibility(v as AgentVisibility)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">{t('collab.visibilityTeam')}</SelectItem>
                    <SelectItem value="personal">{t('collab.visibilityPersonal')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {visibility === 'personal' ? t('collab.visibilityPersonalHint') : t('collab.visibilityTeamHint')}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('collab.ownerLabel')}</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>{t('collab.ownerNone')}</SelectItem>
                  {ownerOptions.map((email) => (
                    <SelectItem key={email} value={email}>
                      {ownerName(email)}{ownerName(email) !== email && <span className="ms-1.5 text-xs text-muted-foreground">{email}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={saveProfile} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {t('collab.saveProfile')}
            </Button>
          </section>

          {/* v1.1 M4: what teammates see + test request */}
          {canEditScope && (
            <section className="space-y-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('collab.teammatePreviewTitle')}</h4>
                <p className="text-[11px] text-muted-foreground">{t('collab.teammatePreviewHint')}</p>
              </div>
              <div className="space-y-2.5 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <AgentAvatar name={entry.agent_name} size={24} />
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{costOwnerText}</span>
                </div>
                <p className={cn(!purpose.trim() && 'italic text-muted-foreground')}>
                  {purpose.trim() || t('collab.purposeMissing')}
                </p>
                {previewExamples.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t('collab.exampleRequests')}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {previewExamples.map((ex) => (
                        <li key={ex} className="truncate text-muted-foreground">“{ex}”</li>
                      ))}
                    </ul>
                  </div>
                )}
                {requiredInputs.trim() && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t('collab.requiredInputs')}</p>
                    <p className="text-muted-foreground">{requiredInputs.trim()}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t('collab.teammatePreviewInstructions')}</p>
                  <p className={cn('whitespace-pre-wrap text-muted-foreground', !instructionsSummary && 'italic')}>
                    {instructionsSummary || t('collab.teammatePreviewNoInstructions')}
                  </p>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <BookOpen className="size-3.5" />
                  {allowedKnowledge.length > 0
                    ? t('collab.teammatePreviewKnowledge', { count: allowedKnowledge.length })
                    : t('collab.teammatePreviewNoKnowledge')}
                </p>
              </div>
              <div className="space-y-1">
                <Button size="sm" variant="outline" onClick={runTestRequest} disabled={!firstExample}>
                  <Play className="size-3.5" />
                  {t('collab.runTestRequest')}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  {firstExample ? t('collab.runTestRequestHint', { agent: name }) : t('collab.runTestRequestNeedsExample')}
                </p>
              </div>
            </section>
          )}

          {/* v1.1 M4: proposals from teammates' requests */}
          {canEditScope && (
            <section className="space-y-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('collab.proposalsSection')}</h4>
                <p className="text-[11px] text-muted-foreground">{t('collab.proposalsHint')}</p>
              </div>
              {proposals === null ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : proposals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('collab.proposalsEmpty')}</p>
              ) : (
                <ul className="space-y-2">
                  {proposals.map((p) => (
                    <li key={p.id} className="space-y-2 rounded-md border p-3">
                      <div className="min-w-0">
                        {p.action && <p className="text-sm font-medium">{p.action}</p>}
                        <p className="text-[11px] text-muted-foreground">
                          {t('collab.proposalFrom', { channel: `#${channelTitle(p.channelName)}` })}
                        </p>
                      </div>
                      {p.details && (
                        <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 text-sm">{p.details}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => resolveProposal(p, 'approve')} disabled={!!resolving}>
                          {resolving === p.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                          {t('collab.proposalAccept')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resolveProposal(p, 'reject')} disabled={!!resolving}>
                          <X className="size-3.5" />
                          {t('collab.proposalDecline')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Grants */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('collab.grantsSection')}</h4>
            {grants === null ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : grants.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('collab.grantsEmpty')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {grants.map((g) => (
                  <li key={g.email} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{g.display_name || displayNameFromEmail(g.email)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {g.email}{g.note ? ` · ${g.note}` : ''}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => revoke(g.email)} title={t('collab.grantRevoke')}>
                      <UserMinus className="size-3.5" />
                      <span className="hidden sm:inline">{t('collab.grantRevoke')}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  placeholder={t('collab.emailPlaceholder')}
                  onKeyDown={(e) => { if (e.key === 'Enter') addGrant(); }}
                  className="flex-1"
                />
                <Button size="sm" onClick={addGrant} disabled={granting || !grantEmail.trim()}>
                  {granting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  {t('collab.grantsAdd')}
                </Button>
              </div>
              <Input
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
                placeholder={t('collab.notePlaceholder')}
                maxLength={200}
              />
              {inviteUrl && (
                <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    {t('collab.grantLinkReady', { email: grantEmail || '…', agent: name })}
                  </p>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={inviteUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(inviteUrl)}>
                      {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {isCopied ? t('common.copied') : t('collab.copyLink')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </SheetBody>

        <SheetFooter className="border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.done')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
