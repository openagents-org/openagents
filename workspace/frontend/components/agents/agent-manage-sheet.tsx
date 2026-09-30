'use client';

// ── v1.1 M2 — "Manage" drawer for an agent the caller owns / administers ─────
// Profile editor (purpose, example requests, required inputs, cost owner,
// visibility, owner) via PATCH members, plus the grants list (who may use the
// agent) with add / revoke.

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Plus, UserMinus } from 'lucide-react';
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
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { apiErrorStatus, displayNameFromEmail, linesToList } from '@/lib/collab';
import type { AgentDirectoryEntry, AgentGrant, AgentVisibility, CostOwner, TeamMember } from '@/lib/types';

/** Radix rejects '' as an item value, so "no owner" needs a sentinel. */
const NO_OWNER = '__none__';

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

  // ── Profile ──
  const [purpose, setPurpose] = useState(entry.purpose || '');
  const [examples, setExamples] = useState((entry.example_requests || []).join('\n'));
  const [requiredInputs, setRequiredInputs] = useState(entry.required_inputs || '');
  const [costOwner, setCostOwner] = useState<CostOwner>(entry.cost_owner || 'owner');
  const [visibility, setVisibility] = useState<AgentVisibility>(entry.visibility || 'team');
  const [owner, setOwner] = useState<string>(entry.owner_email || NO_OWNER);
  const [saving, setSaving] = useState(false);

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
