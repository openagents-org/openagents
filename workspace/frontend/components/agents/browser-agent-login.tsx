'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import type { AgentSetupApi } from './agent-setup-types';
import { encryptAgentCredentials } from './encrypt-agent-credentials';

interface LoginSession {
  sessionId: string;
  type: string;
  status: 'starting' | 'waiting' | 'done' | 'failed' | 'cancelled';
  url?: string;
  code?: string;
  expiresAt: number;
}

export function safeLoginUrl(type: string, value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    if (type === 'codex' && url.hostname === 'auth.openai.com' && url.pathname === '/codex/device') return value;
    if (type === 'claude' && ['claude.ai', 'claude.com'].includes(url.hostname) && url.pathname.endsWith('/oauth/authorize')) return value;
  } catch { /* A malformed device response must never become a sign-in link. */ }
}

export function BrowserAgentLogin({ api, nodeId, type, agent, needsInstall = false, onSignedIn }: {
  api: AgentSetupApi; nodeId: string; type: string; agent: string; needsInstall?: boolean; onSignedIn: () => void;
}) {
  const t = useT();
  const [session, setSession] = useState<LoginSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const alive = useRef(true);
  const sessionRef = useRef<LoginSession | null>(null);
  const success = useRef(onSignedIn);
  success.current = onSignedIn;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const current = sessionRef.current;
      if (current && ['starting', 'waiting'].includes(current.status)) {
        void api.enqueueNodeCommand(nodeId, 'login_cancel', { sessionId: current.sessionId }).catch(() => {});
      }
    };
  }, [api, nodeId]);

  const command = async (action: string, args: Record<string, unknown>): Promise<LoginSession> => {
    const queued = await api.enqueueNodeCommand(nodeId, action, args);
    if (!queued.commandId) throw new Error('Sign-in command unavailable');
    const deadline = Date.now() + (action === 'login_start' ? 360_000 : 45_000);
    while (alive.current && Date.now() < deadline) {
      // A dropped status request does not mean native sign-in failed. Keep
      // polling this same command within the deadline; never enqueue it twice.
      let commands;
      try { commands = await api.listNodeCommands(nodeId); }
      catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const result = commands.find(c => c.commandId === queued.commandId);
      if (result?.status === 'error' || result?.result?.ok === false) throw new Error('Sign-in command failed');
      if (result?.status === 'done') {
        const data = result.result?.data as unknown as LoginSession;
        if (!data?.sessionId || data.type !== type || !Number.isFinite(data.expiresAt) || !['starting', 'waiting', 'done', 'failed', 'cancelled'].includes(data.status)) throw new Error('Invalid sign-in response');
        return data;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Sign-in command timed out');
  };

  const receive = (next: LoginSession) => {
    sessionRef.current = next;
    if (!alive.current) {
      if (['starting', 'waiting'].includes(next.status)) void api.enqueueNodeCommand(nodeId, 'login_cancel', { sessionId: next.sessionId }).catch(() => {});
      return;
    }
    setSession(next);
    if (next.status === 'done') success.current();
    if (next.status === 'failed' || next.status === 'cancelled') setError(true);
  };

  useEffect(() => {
    if (!session || !['starting', 'waiting'].includes(session.status) || error) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (Date.now() >= session.expiresAt) { setError(true); return; }
      try {
        const next = await command('login_status', { sessionId: session.sessionId });
        if (!cancelled) receive(next);
      } catch { if (!cancelled && alive.current) setError(true); }
    }, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
    // Each device response schedules the next poll; there is only one in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, error]);

  const start = async () => {
    // Drop the previous attempt before clearing its error. Otherwise clearing
    // the error re-arms its status poll while the new start is still pending,
    // and an expired/failed old session can hide a valid new sign-in link.
    sessionRef.current = null;
    setSession(null);
    setBusy(true); setError(false); setCode(''); setSubmitted(false); setCopied(false); setCopyFailed(false);
    try { receive(await command('login_start', { type })); }
    catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  };
  const sendCode = async () => {
    if (!session || !code.trim()) return;
    setBusy(true); setError(false);
    try {
      const encrypted = await encryptAgentCredentials(api, nodeId, 'login_input', { sessionId: session.sessionId, config: { code: code.trim() } }, t('agentSetup.secureUnavailable'));
      setCode('');
      if (!alive.current) return;
      receive(await command('login_input', encrypted));
      if (alive.current) setSubmitted(true);
    } catch { if (alive.current) { setCode(''); setError(true); } }
    finally { if (alive.current) setBusy(false); }
  };
  const url = safeLoginUrl(type, session?.url);
  const active = !!session && ['starting', 'waiting'].includes(session.status) && !error;

  return <div data-testid="browser-agent-login" className="flex flex-col gap-4">
    <p className="text-sm leading-relaxed text-muted-foreground">{t('agentSetup.browserLoginHint', { agent })}</p>
    {error && <p role="alert" className="text-sm text-destructive">{t('agentSetup.browserLoginFailed')}</p>}
    {!active && <Button type="button" className="w-fit" onClick={() => void start()} disabled={busy}>{busy && <RefreshCw className="size-4 animate-spin" />}{t(busy && needsInstall ? 'agentSetup.installingForSignIn' : error ? 'agentSetup.retry' : needsInstall ? 'agentSetup.installAndSignIn' : 'agentSetup.openSignIn', { agent })}</Button>}
    {active && !url && <p role="status" className="flex items-center gap-2 text-sm"><RefreshCw className="size-4 animate-spin" />{t('agentSetup.browserLoginStarting')}</p>}
    {active && url && <>
      <div className="flex items-center justify-between gap-3">
        <Button asChild className="w-fit"><a href={url} target="_blank" rel="noopener noreferrer">{t('agentSetup.browserLoginOpen', { agent })}<ExternalLink className="size-4" /></a></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('agentSetup.browserLoginCopyUrl')} title={t('agentSetup.browserLoginCopyUrl')} onClick={async () => {
          try { await navigator.clipboard.writeText(url); setCopied(true); setCopyFailed(false); }
          catch { setCopied(false); setCopyFailed(true); }
        }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}<span className="sr-only" role="status">{copied ? t('common.copied') : ''}</span></Button>
      </div>
      {copyFailed && <p role="alert" className="text-xs text-destructive">{t('agentSetup.browserLoginCopyFailed')}</p>}
      {type === 'codex' && session?.code && <p className="text-sm">{t('agentSetup.browserLoginDeviceCode')} <code className="ml-2 select-all rounded-md bg-muted px-3 py-2 font-mono text-lg font-semibold tracking-widest">{session.code}</code></p>}
      {type === 'claude' && !submitted && <div className="flex flex-col gap-2">
        <label htmlFor="agent-login-code" className="text-sm font-medium">{t('agentSetup.browserLoginCode')}</label>
        <div className="flex gap-2"><Input id="agent-login-code" type="password" autoComplete="off" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} placeholder={t('agentSetup.browserLoginCodeHint')} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void sendCode(); } }} /><Button type="button" disabled={busy || !code.trim()} onClick={() => void sendCode()}>{t('agentSetup.browserLoginConnect')}</Button></div>
      </div>}
      <p role="status" className="text-xs text-muted-foreground">{t(submitted ? 'agentSetup.browserLoginVerifying' : 'agentSetup.browserLoginWaiting')}</p>
    </>}
  </div>;
}
