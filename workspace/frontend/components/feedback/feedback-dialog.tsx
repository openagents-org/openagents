'use client';

import { getApiBaseUrl } from '@/lib/api-base';

/**
 * "Send feedback" dialog — bug reports and feature requests, straight from
 * the user menu to POST /v1/feedback (stored server-side and forwarded to
 * the team). Page URL / workspace / locale ride along automatically so the
 * user only has to write the message.
 */

import { useState } from 'react';
import { Bug, Lightbulb, Send } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';

const API_URL = getApiBaseUrl();

type FeedbackKind = 'bug' | 'feature';

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { workspace } = useWorkspace();
  const { idToken } = useOpenAgentsAuth();
  const [kind, setKind] = useState<FeedbackKind>('feature');
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          <DialogDescription>{t('feedback.body')}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <FieldGroup className="gap-4">
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(v) => { if (v) setKind(v as FeedbackKind); }}
              aria-label={t('feedback.title')}
              className="grid w-full grid-cols-2"
            >
              <ToggleGroupItem value="feature">
                <Lightbulb data-icon="inline-start" />
                {t('feedback.kindFeature')}
              </ToggleGroupItem>
              <ToggleGroupItem value="bug">
                <Bug data-icon="inline-start" />
                {t('feedback.kindBug')}
              </ToggleGroupItem>
            </ToggleGroup>

            <Field>
              <FieldLabel htmlFor="feedback-message">{t('feedback.messageLabel')}</FieldLabel>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={kind === 'bug' ? t('feedback.placeholderBug') : t('feedback.placeholderFeature')}
                autoFocus
                rows={5}
                maxLength={5000}
                className="min-h-28 resize-none"
              />
              <FieldDescription>{t('feedback.contextNote')}</FieldDescription>
            </Field>
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>{t('connect.nodeCancel')}</Button>
          <Button onClick={submit} disabled={!message.trim() || sending}>
            {sending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
            {t('feedback.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
