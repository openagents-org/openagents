'use client';

import { useState } from 'react';
import { Check, ChevronDown, Link2, Pencil, Trash2, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { issueLinkId, resourcePath } from '@/lib/resource-link';
import { shareOrigin } from '@/lib/share-origin';
import { cn } from '@/lib/utils';
import type { IssueDetail, IssueStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { AddIssueParticipants } from './add-issue-participants';
import { IssueProperties } from './issue-properties';
import type { IssueMutate } from './use-issue-detail';
import { IssueAvatar, StatusIcon, authorName, errorMessage, selectClass, statuses, statusKeys, useIssueTime } from './issue-ui';

interface IssueDetailHeaderProps {
  /** The id the discussion was opened with (an issue id or link number). */
  id: string;
  issue: IssueDetail;
  busy: boolean;
  mutate: IssueMutate;
  identity: { source: string; source_name: string };
  /** Participant source → display name, as saved on the issue. */
  people: Map<string, string>;
  /** Fresher names from the workspace roster, keyed by lowercased source. */
  participantNames: Map<string, string>;
  onParticipantsAdded: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onError: (message: string) => void;
}

/** Status, title, author, properties, participants and the issue actions. */
export function IssueDetailHeader({ id, issue, busy, mutate, identity, people, participantNames, onParticipantsAdded, onEdit, onDelete, onError }: IssueDetailHeaderProps) {
  const t = useT();
  const issueTime = useIssueTime();
  const { currentUser, workspace, refreshAgents } = useWorkspace();
  const [copied, setCopied] = useState(false);
  const author = issue.created_by_name || authorName(issue.created_by);

  const copyLink = async () => {
    try {
      const url = new URL(resourcePath(workspace?.slug || workspace?.workspaceId || '', 'issues', issueLinkId(issue)), shareOrigin());
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return (
    <header className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative inline-flex items-center">
          <StatusIcon status={issue.status} className="pointer-events-none absolute left-2 size-3.5" />
          <select id={`issue-status-${id}`} aria-label={t('issues.status')} disabled={busy} value={issue.status}
            className="h-7 appearance-none rounded-md border border-border/70 bg-background pr-7 pl-7 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onChange={event => void mutate(() => workspaceApi.updateIssue(id, { status: event.target.value as IssueStatus, ...identity }))}>
            {statuses.map(status => <option key={status} value={status}>{t(statusKeys[status])}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
        </div>
      </div>
      <h1 className="max-w-[32ch] text-2xl leading-snug font-semibold tracking-tight wrap-break-word sm:text-3xl">
        {issue.title}
        {issue.number != null && <span className="ml-2 font-normal text-muted-foreground">#{issue.number}</span>}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <IssueAvatar name={author} source={issue.created_by} size={22} />
        <span className="font-medium text-foreground/75">{author}</span>
        <span>{t('issues.openedIssue')}</span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <time dateTime={issue.created_at} title={issueTime.exact(issue.created_at)}>
          {issueTime.label(issue.created_at)}
        </time>
      </div>
      <div className="mt-3 flex flex-col gap-2 border-y border-border/60 py-2">
        <div className="grid grid-cols-1 items-center gap-x-5 gap-y-1 sm:grid-cols-2">
          <IssueProperties issue={issue} busy={busy} update={values => void mutate(() => workspaceApi.updateIssue(id, { ...values, ...identity }))} />
          <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="shrink-0">{t('threadSettings.shareMyAgents')}</span>
            <select className={cn(selectClass, 'h-8 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs font-normal hover:border-border')} aria-label={t('threadSettings.shareMyAgents')}
              value={issue.agent_sharing_mode || 'no'} disabled={busy}
              onChange={event => void mutate(async () => { await workspaceApi.setIssueAgentSharing(id, event.target.value as 'no' | 'yes' | 'approval'); await refreshAgents(); })}>
              <option value="no">{t('threadSettings.sharingNo')}</option>
              <option value="yes">{t('threadSettings.sharingYes')}</option>
              <option value="approval">{t('threadSettings.sharingApproval')}</option>
            </select>
          </label>
        </div>
        <section aria-label={t('issues.participants')} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-xs text-muted-foreground">{t('issues.participants')} <span className="ml-1 tabular-nums">{people.size}</span></h2>
            <AddIssueParticipants issueId={id} existing={Array.from(people.keys())} onAdded={onParticipantsAdded} />
          </div>
          {people.size > 0 && <div className="flex flex-wrap gap-1.5">
            {Array.from(people, ([person, savedName]) => {
              const name = participantNames.get(person.toLowerCase()) || savedName;
              const participant = issue.participants.find(item => item.source === person);
              const owner = participant?.owner_name || participant?.owner_email;
              const access = participant?.request_access;
              const accessLabel = access ? t(participant?.owner_email?.toLowerCase() === currentUser.id.toLowerCase() ? 'messageAgentAccess.yours' : access === 'yes' ? 'messageAgentAccess.shared' : access === 'approval' ? 'messageAgentAccess.approval' : 'messageAgentAccess.notShared') : '';
              const hint = [name, owner && t('messageAgentAccess.owner', { name: owner }), accessLabel].filter(Boolean).join('\n');
              return <span key={person} title={hint} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-muted/20 py-1 pr-2.5 pl-1 text-xs">
                <IssueAvatar source={person} name={name} size={20} />
                <span className="max-w-36 truncate">{name}</span>
                {person.startsWith('openagents:') && <Button variant="ghost" size="icon-xs" disabled={busy}
                  className="-my-1 -mr-1.5 rounded-full text-muted-foreground"
                  aria-label={t('issues.removeAgent', { name })} title={t('issues.removeAgent', { name })}
                  onClick={() => void mutate(() => workspaceApi.removeIssueAgent(id, person.slice('openagents:'.length)))}><X /></Button>}
              </span>;
            })}
          </div>}
        </section>
      </div>
      {/* Under the title, where the eye already is — tucked in the
          detail header's right corner they were easy to miss. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void copyLink()}>
          {copied ? <Check data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
          {t(copied ? 'common.copied' : 'issues.copyLink')}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil data-icon="inline-start" />
          {t('common.edit')}
        </Button>
        {issue.can_delete && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
            <Trash2 data-icon="inline-start" />
            {t('common.delete')}
          </Button>
        )}
      </div>
    </header>
  );
}
