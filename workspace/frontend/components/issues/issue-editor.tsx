'use client';
import { useEffect, useId, useState } from 'react';
import { CircleDot, Link2, ChevronRight } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { WorkspaceIssue } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IssueMentionInput } from './issue-mention-input';
import { useIssueMentions } from './use-issue-mentions';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { cn } from '@/lib/utils';
import { ErrorNotice, errorMessage, selectClass } from './issue-ui';

export function IssueEditor({
  open,
  onOpenChange,
  issue,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue?: WorkspaceIssue;
  onSaved: (issue: WorkspaceIssue) => void;
}) {
  const t = useT();
  const descriptionId = useId();
  const { currentUser, sessions } = useWorkspace();
  const mentions = useIssueMentions(issue);
  const [title, setTitle] = useState(issue?.title ?? '');
  const [description, setDescription] = useState(issue?.description ?? '');
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setTitle(issue?.title ?? '');
      setDescription(issue?.description ?? '');
      setChannel('');
      setError('');
    }
  }, [open, issue?.id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = {
        title: title.trim(),
        description,
        source: `human:${currentUser.id}`,
        source_name: currentUser.name,
      };
      const result = issue
        ? await workspaceApi.updateIssue(issue.id, input)
        : await workspaceApi.createIssue({
            ...input,
            ...(channel ? { channel_name: channel } : {}),
          });
      onSaved(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="max-w-[620px]">
        <DialogHeader className="border-b border-border/60 pb-4">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <CircleDot className="size-4 text-muted-foreground" />
            {t(issue ? 'issues.editIssue' : 'issues.newIssue')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-5 py-5">
            <label className="block">
              <span className="sr-only">{t('issues.title')}</span>
              <Input
                autoFocus
                disabled={busy}
                value={title}
                maxLength={240}
                required
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('issues.titlePlaceholder')}
                className="h-auto rounded-none border-0 px-0 py-1 text-xl font-medium leading-7 tracking-tight shadow-none placeholder:font-normal focus-visible:ring-0"
              />
            </label>
            <div className="block">
              <label htmlFor={descriptionId} className="sr-only">
                {t('issues.description')}
              </label>
              <IssueMentionInput
                id={descriptionId}
                inlineSuggestions
                mentions={mentions}
                disabled={busy}
                value={description}
                maxLength={50000}
                onValueChange={setDescription}
                placeholder={t('issues.descriptionPlaceholder')}
                className="min-h-44 resize-y rounded-none border-0 px-0 text-[13px] leading-6 shadow-none focus-visible:ring-0"
              />
            </div>
            {!issue && sessions.length > 0 && (
              <details className="group/link border-t border-border/60 pt-4">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <Link2 className="size-3.5" />
                  {t('issues.sourceThread')}
                  <ChevronRight className="ml-auto size-3 transition-transform group-open/link:rotate-90" />
                </summary>
                <select
                  disabled={busy}
                  aria-label={t('issues.sourceThread')}
                  className={cn(selectClass, 'mt-3 w-full text-xs')}
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  <option value="">{t('issues.noThread')}</option>
                  {sessions
                    .filter(
                      (s) =>
                        s.status !== 'deleted' &&
                        !s.sessionId.startsWith('task:') &&
                        !s.sessionId.startsWith('routine:'),
                    )
                    .map((s) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {s.title || s.sessionId}
                      </option>
                    ))}
                </select>
              </details>
            )}
            {error && <ErrorNotice message={error} />}
          </DialogBody>
          <DialogFooter className="items-center border-t border-border/60 bg-muted/15 py-4 sm:justify-between">
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              {t(issue ? 'issues.editHint' : 'issues.createHint')}
            </p>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button
                size="sm"
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="mono"
                type="submit"
                disabled={busy || !title.trim()}
              >
                {t(
                  busy
                    ? 'common.saving'
                    : issue
                      ? 'common.save'
                      : 'issues.createIssue',
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
