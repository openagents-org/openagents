'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, FileText, LoaderCircle, MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiBaseUrl } from '@/lib/api-base';
import { request } from '@/lib/guest-thread-api';
import { fetchJam } from '@/lib/jam-api';

interface Draft {
  title: string;
  agent_name: string;
  agent_type: string | null;
  owner_name: string | null;
  intro: string | null;
  excerpts: { author: 'owner' | 'agent'; text: string }[];
  files: string[];
  guest_agent_access: 'open' | 'approval' | 'off';
  access: 'link' | 'invited';
  invited_emails: string[];
  guests_can_post: boolean;
  guests_can_bring_agents: boolean;
  link_expires_at: string | null;
}
interface Published {
  slug: string;
  token: string;
  ownerUrl: string;
  guestUrl: string;
  agentName: string;
}
type Review = { status: 'draft'; draft: Draft } | { status: 'published'; draft: Draft; jam: Published };

const section = 'space-y-4 rounded-xl border bg-card p-5 sm:p-6';
const inputStyle = 'h-9 w-full rounded-md border bg-background px-3 text-sm';
const setupApi = () => getApiBaseUrl() + '/v1/jam/setup';
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Unable to reach OpenAgents. Please try again.';

function PublishedJam({ jam, draft }: { jam: Published; draft: Draft }) {
  const [connection, setConnection] = useState('Checking connection…');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const state = await fetchJam({ slug: jam.slug, token: jam.token });
        const agent = state.agents.find(a => a.name === jam.agentName);
        if (active) setConnection(!agent?.online ? 'Waiting for the launcher on your computer' :
          agent.acceptsGuests === false ? 'Connected · guest requests unavailable' : 'Agent connected');
      } catch {
        if (active) setConnection('Connection status unavailable · retrying');
      }
      if (active) timer = setTimeout(check, 5000);
    }
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [jam]);
  return <section className={section}>
    <CheckCircle2 className="size-6 text-primary" />
    <h1 className="text-2xl font-semibold">Your jam is created</h1>
    <p className="text-muted-foreground">{draft.title}</p>
    <div className="rounded-lg bg-muted px-4 py-3 text-sm" role="status">
      <strong>@{jam.agentName}</strong> · {connection}
    </div>
    <p className="text-sm">Return to your agent conversation to finish connecting the launcher and uploading any selected files.</p>
    <label className="block space-y-2 text-sm font-medium">Guest link
      <Input readOnly value={jam.guestUrl} onFocus={e => e.currentTarget.select()} />
    </label>
    <Button asChild><a href={jam.ownerUrl}>Open owner view <ArrowRight /></a></Button>
  </section>;
}

function DraftForm({ draft, secret, published }: { draft: Draft; secret: string; published: (value: Review) => void }) {
  const [title, setTitle] = useState(draft.title);
  const [selected, setSelected] = useState({ excerpts: draft.excerpts.map(() => true), files: draft.files.map(() => true) });
  const [access, setAccess] = useState(draft.access);
  const [emails, setEmails] = useState(draft.invited_emails.join(', '));
  const [policy, setPolicy] = useState(draft.guest_agent_access);
  const [expiry, setExpiry] = useState(draft.link_expires_at ? 'keep' : 'never');
  const [post, setPost] = useState(draft.guests_can_post);
  const [bring, setBring] = useState(draft.guests_can_bring_agents);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const indices = (items: boolean[]) => items.flatMap((yes, i) => yes ? [i] : []);
  function toggle(field: 'excerpts' | 'files', index: number) {
    setSelected(s => ({ ...s, [field]: s[field].map((v, i) => i === index ? !v : v) }));
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      published(await request<Review>(setupApi() + '/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jam-Setup': secret },
        body: JSON.stringify({ title: title.trim(), excerpts: indices(selected.excerpts), files: indices(selected.files),
          access, expiry, invited_emails: emails.split(/[,;\s]+/).filter(Boolean), guest_agent_access: policy,
          guests_can_post: post, guests_can_bring_agents: bring }),
      }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <form onSubmit={confirm} className="space-y-5">
    <header className="space-y-2"><h1 className="text-3xl font-semibold tracking-tight">Review your jam</h1>
      <p className="text-muted-foreground">Choose what teammates will see from this conversation with @{draft.agent_name}.</p></header>
    <section className={section}>
      <label className="block space-y-2 text-sm font-medium">Jam title<Input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
      {draft.intro && <div><h2 className="text-sm font-medium">Opening message</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm">{draft.intro}</p></div>}
    </section>
    <section className={section}><h2 className="font-semibold">Shared context</h2>
      {!draft.excerpts.length && !draft.files.length && <p className="text-sm text-muted-foreground">This jam starts with no excerpts or files.</p>}
      {draft.excerpts.map((item, i) => <label key={i} className="flex items-start gap-3 border-t pt-3 text-sm">
        <input type="checkbox" className="mt-1" checked={selected.excerpts[i]} onChange={() => toggle('excerpts', i)} />
        <span className="min-w-0"><strong>{item.author === 'owner' ? draft.owner_name || 'You' : draft.agent_name}</strong>
          <span className="mt-1 block whitespace-pre-wrap break-words">{item.text}</span></span></label>)}
      {draft.files.map((file, i) => <label key={i} className="flex items-center gap-3 border-t pt-3 text-sm">
        <input type="checkbox" checked={selected.files[i]} onChange={() => toggle('files', i)} /><FileText className="size-4 shrink-0" /><span className="break-all">{file}</span></label>)}
    </section>
    <section className={section}><h2 className="font-semibold">Guest access</h2>
      <p className="text-sm text-muted-foreground">{draft.agent_type === 'claude'
        ? 'Your agent can answer guests while your computer is online and its launcher is running.'
        : 'Guests can read the jam. Answering guest requests currently requires a connected Claude Code agent.'}</p>
      <label className="block space-y-2 text-sm">Who can open the jam?
        <select value={access} className={inputStyle} onChange={e => setAccess(e.target.value as Draft['access'])}><option value="link">Anyone with the link</option><option value="invited">Invited people only</option></select></label>
      {access === 'invited' && <label className="block space-y-2 text-sm">Invited email addresses<Input required value={emails} onChange={e => setEmails(e.target.value)} placeholder="alex@example.com, sam@example.com" /></label>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={post} onChange={e => setPost(e.target.checked)} /> Allow guests to post</label>
      {post && <><label className="block space-y-2 text-sm">When a guest asks the agent
        <select value={policy} className={inputStyle} onChange={e => setPolicy(e.target.value as Draft['guest_agent_access'])}><option value="open">Run the request</option><option value="approval">Ask me for approval first</option><option value="off">Allow comments only</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bring} onChange={e => setBring(e.target.checked)} /> Allow guests to bring their own agents</label></>}
      <label className="block space-y-2 text-sm">Guest link expires
        <select className={inputStyle} value={expiry} onChange={e => setExpiry(e.target.value)}>
          {draft.link_expires_at && <option value="keep">{new Date(draft.link_expires_at).toLocaleString()}</option>}
          <option value="never">Never</option><option value="1">After 1 day</option><option value="7">After 7 days</option><option value="30">After 30 days</option>
        </select></label>
    </section>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Only the selected context will be shared.</p>
      <Button disabled={busy || !title.trim()} type="submit">{busy ? <LoaderCircle className="animate-spin" /> : null} Create jam <ArrowRight /></Button></div>
  </form>;
}

export function JamSetup() {
  const [secret, setSecret] = useState<string | null>(null);
  const [state, setState] = useState<Review>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    function readLink() {
      setState(undefined);
      setError('');
      setSecret(window.location.hash.slice(1));
    }
    readLink();
    window.addEventListener('hashchange', readLink);
    return () => window.removeEventListener('hashchange', readLink);
  }, []);
  useEffect(() => {
    if (secret === null) return;
    if (!secret) { setError('Open the private setup link your agent gave you.'); return; }
    let active = true;
    setError('');
    request<Review>(setupApi(), { headers: { 'X-Jam-Setup': secret }, cache: 'no-store' })
      .then(s => { if (active) setState(s); }).catch(e => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [secret, attempt]);
  return <main className="h-dvh overflow-y-auto bg-muted/30 text-foreground">
    <div className="mx-auto max-w-2xl space-y-7 px-5 py-8 sm:py-12">
      <div className="flex items-center gap-2 text-sm font-semibold"><MessagesSquare className="size-5" /> OpenAgents Jam</div>
      {error ? <div className={section}><p role="alert">{error}</p>{secret && <Button variant="outline" onClick={() => setAttempt(x => x + 1)}>Try again</Button>}</div>
        : !state ? <p role="status">Loading your draft…</p>
        : state.status === 'published' ? <PublishedJam jam={state.jam} draft={state.draft} />
        : <DraftForm draft={state.draft} secret={secret!} published={value => { if (window.location.hash.slice(1) === secret) setState(value); }} />}
    </div>
  </main>;
}
