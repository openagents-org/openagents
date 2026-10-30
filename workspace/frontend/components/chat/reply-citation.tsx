'use client';
import { Reply, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useHumanNames } from '@/hooks/use-team-roster';
import { useT } from '@/lib/i18n';
import { messagePath } from '@/lib/thread-link';
import type { WorkspaceMessage } from '@/lib/types';

export interface ReplyCitationData {
  message_id: string;
  sender_name: string;
  sender_address?: string;
  content: string;
  thread_id: string;
  recalled?: boolean;
}
export function citationFor(message: WorkspaceMessage): ReplyCitationData {
  const attachments = message.metadata.attachments as { filename?: string }[] | undefined;
  return { message_id: message.messageId, sender_name: message.senderName,
    sender_address: message.senderAddress || undefined, thread_id: message.sessionId,
    content: (message.content || attachments?.map(a => a.filename).join(', ') || '').slice(0, 500) };
}
export function ReplyCitation({ citation, onCancel }: { citation?: ReplyCitationData; onCancel?: () => void }) {
  const { workspace } = useWorkspace();
  const names = useHumanNames();
  const t = useT();
  if (!citation?.message_id) return null;
  const email = citation.sender_address?.replace(/^human:/, '').toLowerCase();
  const name = (email && names[email]) || citation.sender_name;
  const body = <><span className="flex items-center gap-1.5 text-xs font-medium"><Reply aria-hidden="true" className="size-3.5 shrink-0" />{t('messageReply.to', { name })}</span>
    <span className="mt-1 block line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{citation.recalled ? t('messageReply.recalled') : citation.content || t('messageReply.attachment')}</span></>;
  return <div className="relative my-2 rounded-md border-l-2 border-primary/50 bg-muted/40 text-foreground">
    {onCancel ? <div className="px-3 py-2 pr-9">{body}</div> : <a className="block rounded-md px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={messagePath(workspace?.slug || workspace?.workspaceId || '', citation.thread_id, citation.message_id)}>{body}</a>}
    {onCancel && <button type="button" aria-label={t('messageReply.cancel')} onClick={onCancel} className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>}
  </div>;
}
