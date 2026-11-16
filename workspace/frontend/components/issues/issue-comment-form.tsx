'use client';

import { Send, X } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { AttachmentPicker } from '@/components/tasks/attachment-picker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { IssueMentionInput } from './issue-mention-input';
import { mentionsAgent } from './issue-mentions';
import type { useIssueMentions } from './use-issue-mentions';
import type { IssueMutate } from './use-issue-detail';
import { IssueAvatar } from './issue-ui';

export interface CommentDraft {
  comment: string;
  setComment: (value: string | ((value: string) => string)) => void;
  replyTo: { eventId: string; name: string } | null;
  setReplyTo: (value: { eventId: string; name: string } | null) => void;
  files: string[];
  setFiles: (files: string[]) => void;
  uploading: boolean;
  setUploading: (uploading: boolean) => void;
  /** Bumped to remount the attachment picker after a post. */
  pickerKey: number;
  resetPicker: () => void;
}

interface IssueCommentFormProps {
  id: string;
  busy: boolean;
  busyRef: React.RefObject<boolean>;
  mutate: IssueMutate;
  identity: { source: string; source_name: string };
  userName: string;
  /** Participant sources already on the issue. */
  people: Map<string, string>;
  /** Agents the viewer may ask for work, as `openagents:<name>`. */
  usableAgents: Set<string>;
  mentions: ReturnType<typeof useIssueMentions>;
  draft: CommentDraft;
  onDispatchError: (message: string) => void;
}

export function IssueCommentForm({ id, busy, busyRef, mutate, identity, userName, people, usableAgents, mentions, draft, onDispatchError }: IssueCommentFormProps) {
  const t = useT();
  const { comment, setComment, replyTo, setReplyTo, files, setFiles, uploading, setUploading, pickerKey, resetPicker } = draft;
  const canPost = !uploading && (!!comment.trim() || files.length > 0);

  return (
    <form
      className="relative mt-8 flex gap-3"
      onKeyDownCapture={(e) => {
        if (e.target instanceof HTMLTextAreaElement && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          if (!busyRef.current && canPost) e.currentTarget.requestSubmit();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (busyRef.current || !canPost) return;
        // Mentioning an agent not yet on the issue adds it before the comment is posted.
        const invite = [...usableAgents].filter(source => !people.has(source))
          .map(source => source.slice('openagents:'.length))
          .filter(name => mentionsAgent(comment, name));
        void mutate(
          async () => {
            // Adding participants is idempotent, so a failed post can be retried.
            if (invite.length) await workspaceApi.addIssueParticipants(id, invite.map(name => ({ kind: 'agent' as const, id: name })));
            const result = await workspaceApi.commentOnIssue(id, {
              content: comment,
              ...(files.length ? { file_ids: files } : {}),
              ...(replyTo ? { reply_to_event_id: replyTo.eventId } : {}),
              ...identity,
            });
            if (result.dispatch_error) onDispatchError(result.dispatch_error);
          },
          () => { setComment(''); setReplyTo(null); setFiles([]); resetPicker(); },
        );
      }}
    >
      <span className="mt-1 hidden sm:block">
        <IssueAvatar name={userName} source={identity.source} />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-background shadow-xs transition-shadow focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/10">
        {replyTo && <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
          <span>{t('issues.replyingTo', { name: replyTo.name })}</span>
          <Button variant="ghost" size="icon-xs" disabled={busy} onClick={() => setReplyTo(null)} aria-label={t('issues.cancelReply')}><X /></Button>
        </div>}
        <Label className="px-4 pt-3" htmlFor={`issue-comment-${id}`}>
          {t('issues.addComment')}
        </Label>
        <IssueMentionInput
          mentions={mentions.filter((m) => m.kind === 'human' || people.has(m.source) || usableAgents.has(m.source))}
          readOnly={busy}
          id={`issue-comment-${id}`}
          className="min-h-24 resize-y rounded-none border-0 px-4 py-3 text-sm shadow-none focus-visible:ring-0"
          value={comment}
          maxLength={50000}
          onValueChange={setComment}
          placeholder={t('issues.commentPlaceholder')}
        />
        <div className="px-3 pb-2">
          <AttachmentPicker key={pickerKey} compact value={files} onChange={setFiles}
            disabled={busy} onUploadingChange={setUploading} />
        </div>
        <div className="flex items-center justify-end gap-3 px-3 pb-3">
          <Button
            size="sm"
            type="submit"
            className="shrink-0"
            title={t('issues.commentShortcut')}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            disabled={busy || !canPost}
          >
            {t(uploading ? 'tasks.attachUploading' : 'issues.postComment')}
            <Send data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </form>
  );
}
