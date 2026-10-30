'use client';
import { useState } from 'react';
import { Link, Check } from 'lucide-react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { messageLink } from '@/lib/thread-link';
import { shareOrigin } from '@/lib/share-origin';

export function CopyMessageLink({ messageId }: { messageId: string }) {
  const { workspace, currentSessionId } = useWorkspace();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!workspace || !currentSessionId || messageId.startsWith('optimistic-')) return null;
  const copy = async () => {
    setBusy(true);
    try {
      const link = await workspaceApi.getThreadLink(currentSessionId);
      await navigator.clipboard.writeText(messageLink(shareOrigin(), workspace.slug || workspace.workspaceId, link.id, messageId));
      setCopied(true);
      toast.success(t('common.copied'));
    } catch { toast.error(t('reactions.linkFailed')); }
    finally { setBusy(false); }
  };
  return <button type="button" disabled={busy} title={t('reactions.copyLink')} aria-label={t('reactions.copyLink')} onClick={() => void copy()} onBlur={() => setCopied(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">{copied ? <Check className="size-3.5" /> : <Link className="size-3.5" />}</button>;
}
