'use client';

/**
 * "Send feedback" dialog — bug reports and feature requests, straight from
 * the user menu to POST /v1/feedback (stored server-side and forwarded to
 * the team). Page URL / workspace / locale ride along automatically so the
 * user only has to write the message.
 */

import { useState } from 'react';
import { Bug, Lightbulb, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { workspace } = useWorkspace();
  const { idToken } = useOpenAgentsAuth();
  const [kind, setKind] = useState<'bug' | 'feature'>('feature');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${API_URL}/v1/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          network: workspace?.workspaceId || undefined,
          context: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            locale: navigator.language,
          },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || (json && json.code !== 0)) {
        throw new Error(json?.message || `HTTP ${res.status}`);
      }
      toast.success(t('feedback.thanks'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-4 rounded-2xl border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-semibold">{t('feedback.title')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('feedback.body')}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {([
            { id: 'feature' as const, icon: Lightbulb, label: t('feedback.kindFeature') },
            { id: 'bug' as const, icon: Bug, label: t('feedback.kindBug') },
          ]).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setKind(id)}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                kind === id
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={kind === 'bug' ? t('feedback.placeholderBug') : t('feedback.placeholderFeature')}
          autoFocus
          rows={5}
          maxLength={5000}
          className="w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{t('feedback.contextNote')}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={sending}>{t('connect.nodeCancel')}</Button>
            <Button onClick={submit} disabled={!message.trim() || sending}>
              {sending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Send className="mr-1.5 size-4" />}
              {t('feedback.submit')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
