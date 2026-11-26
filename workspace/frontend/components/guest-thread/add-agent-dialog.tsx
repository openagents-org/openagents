'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Terminal } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { agentTypeLabel } from '@/lib/guest-thread';
import { GuestThreadError, type AddedAgent } from '@/lib/guest-thread-api';
import { useT } from '@/lib/i18n';
import { AGENT_NAME_MAX, GUEST_CAPABLE_TYPES, JAM_AGENT_TYPES, agentNameProblem, connectParagraph } from '@/lib/jam-agents';

/** What adding failed on, for the caller (a guest without a name is asked for one). */
export class NeedsNameError extends Error {}

/**
 * "Add agent" for a jam: a name (checked as you type), a runtime, one line
 * on what it means, then the three commands that connect it — with a copy
 * button for pasting into a coding agent. A guest's token is shown once.
 */
export function AddAgentDialog({ open, onOpenChange, viewer, firstAgent, onAdd, onNeedName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: 'owner' | 'guest';
  /** The jam's own agent ("Runs on your computer, like pr-reviewer"). */
  firstAgent: string | null;
  onAdd: (agent: { name: string; type: string }) => Promise<AddedAgent>;
  /** A guest has to pick a name first (401). */
  onNeedName?: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('claude');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddedAgent | null>(null);
  const [copied, setCopied] = useState<null | 'commands' | 'agent'>(null);

  useEffect(() => {
    if (open) return;
    setName(''); setType('claude'); setTouched(false); setBusy(false); setError(null); setResult(null); setCopied(null);
  }, [open]);

  const problem = agentNameProblem(name.trim() === name ? name : name);
  const problemText = problem && problem !== 'empty' ? t(`jamAgents.name_${problem}`, { max: AGENT_NAME_MAX }) : null;
  const typeLabel = (value: string) => agentTypeLabel(value) || value;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true); setError(null);
    try {
      setResult(await onAdd({ name, type }));
    } catch (err) {
      const status = err instanceof GuestThreadError ? err.status : null;
      if (status === 401 || err instanceof NeedsNameError) { onNeedName?.(); return; }
      setError(status === 409 ? t('jamAgents.nameTaken', { name })
        : status === 429 ? t('jamAgents.limit')
        : status === 403 ? t('jamAgents.notAllowed')
        : status === 400 && err instanceof Error && err.message && !/^HTTP/.test(err.message) ? err.message
        : t('jamAgents.failed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: 'commands' | 'agent') => {
    if (!result) return;
    const text = what === 'commands' ? result.commands.join('\n') : connectParagraph(result.commands, t('jamAgents.pasteIntro'));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* the commands are on screen to copy by hand */ }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg" data-add-agent-dialog={viewer}>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('jamAgents.addedTitle', { name: result.agent.name })}</DialogTitle>
              <DialogDescription>{t('jamAgents.addedBody')}</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-3" data-add-agent-step="done">
              <div className="overflow-hidden rounded-lg border">
                <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                  <Terminal className="size-3.5" /><span className="flex-1">{t('jamAgents.commands')}</span>
                  <Button size="xs" variant="ghost" onClick={() => void copy('commands')} data-add-agent-copy="commands">
                    {copied === 'commands' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied === 'commands' ? t('common.copied') : t('common.copy')}
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs leading-5" data-add-agent-commands="">{result.commands.join('\n')}</pre>
              </div>
              {result.token && (
                <Alert className="border-warning/30 bg-warning/10 text-warning" data-add-agent-token-once="">
                  <KeyRound />
                  <AlertDescription className="text-xs text-warning">{t('jamAgents.tokenOnce')}</AlertDescription>
                </Alert>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
              <Button onClick={() => void copy('agent')} data-add-agent-copy="agent">
                {copied === 'agent' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied === 'agent' ? t('common.copied') : t('jamAgents.copyForAgent')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>{t('jamAgents.title')}</DialogTitle>
              <DialogDescription data-add-agent-explain="">
                {viewer === 'owner'
                  ? (firstAgent ? t('jamAgents.ownerExplain', { agent: firstAgent }) : t('jamAgents.ownerExplainNoAgent'))
                  : t('jamAgents.guestExplain')}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-3" data-add-agent-step="form">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jam-agent-name">{t('jamAgents.name')}</Label>
                <Input id="jam-agent-name" value={name} autoFocus autoComplete="off" spellCheck={false}
                  onChange={(e) => { setName(e.target.value); setError(null); }}
                  onBlur={() => setTouched(true)}
                  placeholder={t('jamAgents.namePlaceholder')}
                  aria-invalid={(!!problemText && (touched || name.length > 0)) || undefined}
                  className="font-mono" data-add-agent-name="" />
                {problemText && (touched || name.length > 0)
                  ? <p className="text-xs text-destructive" role="alert" data-add-agent-name-error="">{problemText}</p>
                  : <p className="text-xs text-muted-foreground">{t('jamAgents.nameHint', { max: AGENT_NAME_MAX })}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jam-agent-type">{t('jamAgents.type')}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="jam-agent-type" className="w-full" data-add-agent-type="">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JAM_AGENT_TYPES.map((value) => <SelectItem key={value} value={value} data-add-agent-type-option={value}>{typeLabel(value)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!GUEST_CAPABLE_TYPES.includes(type) && (
                  <p className="text-xs text-muted-foreground" data-add-agent-type-note="">{t('jamAgents.onlyClaudeTakesRequests', { type: typeLabel(type) })}</p>
                )}
              </div>
              {error && <Alert variant="destructive" data-add-agent-error=""><AlertDescription>{error}</AlertDescription></Alert>}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={busy || !!problem} data-add-agent-submit="">
                {busy && <Spinner data-icon="inline-start" />}{t('jamAgents.add')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
