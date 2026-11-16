'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription } from '@/components/ui/item';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/responsive-dialog';
import { IssueAssigneePicker, type AssigneeChoice } from './issue-assignee-picker';
import { IssueContextPicker } from './issue-context-picker';
import { ErrorNotice, errorMessage } from './issue-ui';

/** Invite an agent, then use the same mention dispatch as an ordinary comment. */
export function IssueWork({ issueId, closed, onPosted }: {
  issueId: string;
  closed: boolean;
  onPosted: (warning?: string) => void;
}) {
  const { currentUser } = useWorkspace();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<AssigneeChoice[] | null>(null);
  const [agent, setAgent] = useState('');
  const [instruction, setInstruction] = useState('');
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setChoices(null);
    setError('');
    Promise.all([workspaceApi.discover(), workspaceApi.getIssue(issueId)]).then(([result, issue]) => {
      // Discovery grants allow new requests anywhere. Issue-specific sharing
      // can additionally allow an agent already participating in this issue.
      const allowedHere = new Set(issue.participants.filter(p => p.request_access === 'yes' || p.request_access === 'approval').map(p => p.source));
      if (active) setChoices(result.agents.filter(a => !a.builtin && a.status === 'online' &&
        (a.can_start_thread === true || allowedHere.has(`openagents:${a.address.replace(/^openagents:/, '')}`))).map(a => ({
        id: `openagents:${a.address.replace(/^openagents:/, '')}`,
        name: a.display_name?.trim() || a.address.replace(/^openagents:/, ''),
      })));
    }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [open, attempt, issueId]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || closed || !choices?.some(a => a.id === agent)) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const name = agent.slice('openagents:'.length);
      // Adding an existing participant is idempotent, so a failed comment can
      // safely be retried without duplicating participants or losing the draft.
      await workspaceApi.addIssueParticipants(issueId, [{ kind: 'agent', id: name }]);
      const result = await workspaceApi.commentOnIssue(issueId, {
        source: `human:${currentUser.id}`, source_name: currentUser.name,
        ...(knowledgeIds.length ? { knowledge_ids: knowledgeIds } : {}),
        content: `@${name}${instruction.trim() ? ` ${instruction.trim()}` : ''}`,
      });
      // Dispatch errors mean the comment was saved: clear the draft rather than
      // encouraging a duplicate request. Show the delivery warning on the issue.
      setInstruction('');
      setKnowledgeIds([]);
      setAgent('');
      setOpen(false);
      onPosted(result.dispatch_error);
    } catch (e) { setError(errorMessage(e)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Item asChild variant="outline" className="mb-8 flex-wrap">
    <section>
    <ItemContent>
      <ItemDescription className="text-xs">{t(closed ? 'issueWork.closed' : 'issueWork.assignHint')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Button size="sm" variant="outline" disabled={closed} onClick={() => setOpen(true)}><Bot data-icon="inline-start" />{t('issueWork.assignAgent')}</Button>
    </ItemActions>
    <Dialog open={open} onOpenChange={value => { if (!submitting.current) setOpen(value); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t('issueWork.assignAgent')}</DialogTitle><DialogDescription>{t('issueWork.assignHint')}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="flex flex-col gap-4">
            {choices ? choices.length ? <IssueAssigneePicker agentsOnly value={agent} onChange={setAgent} choices={choices} disabled={busy} /> : <p className="text-sm text-muted-foreground">{t('issueWork.noAgents')}</p> : !error && <Spinner />}
            <Field>
              <FieldLabel htmlFor={`issue-work-instruction-${issueId}`}>{t('issueWork.instruction')}</FieldLabel>
              <Textarea id={`issue-work-instruction-${issueId}`} aria-label={t('issueWork.instruction')} value={instruction} onChange={e => setInstruction(e.target.value)} disabled={busy} maxLength={Math.max(0, 49998 - agent.length)} placeholder={t('issueWork.instructionPlaceholder')} className="min-h-28 resize-y" />
            </Field>
            <IssueContextPicker value={knowledgeIds} onChange={setKnowledgeIds} disabled={busy} />
            {error && <ErrorNotice message={error} />}
            {!choices && error && <Button type="button" variant="outline" onClick={() => setAttempt(n => n + 1)}>{t('common.retry')}</Button>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={busy || closed || !choices?.some(a => a.id === agent)}>{busy && <Spinner data-icon="inline-start" />}{t('issueWork.send')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </section>
  </Item>;
}
