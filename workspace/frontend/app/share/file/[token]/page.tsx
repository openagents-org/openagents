'use client';

/**
 * /share/file/<token> — a file someone shared with "anyone with the link".
 * No sign-in and no workspace: the token is the whole credential.
 *
 * Anyone can share anything here, under our domain, so nothing shared may
 * act like a page of ours. HTML is shown as its source, never rendered: even
 * sandboxed, a rendered page could pass for an OpenAgents sign-in form. SVG
 * is drawn in an iframe with every sandbox restriction on (no script, no
 * forms, no navigation), not from a blob URL that would run its script in
 * our origin if opened in a tab. Audio and video stream from the API instead
 * of being downloaded whole first. No request carries a referrer: the token
 * is in this page's URL.
 */

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { getApiBaseUrl } from '@/lib/api-base';
import { useFormatters, useT } from '@/lib/i18n';
import type { PublicFileInfo } from '@/lib/types';

const API_URL = getApiBaseUrl();
/** Past this, text kinds are offered as a download instead of a preview. */
const PREVIEW_LIMIT = 20 * 1024 * 1024;

type Body =
  | { kind: 'html' | 'svg' | 'markdown' | 'text'; text: string }
  | { kind: 'image' | 'pdf' | 'video' | 'audio'; url: string }
  | { kind: 'none' };

function previewKind(info: PublicFileInfo): Body['kind'] {
  const type = (info.content_type || '').toLowerCase();
  const name = info.filename.toLowerCase();
  if (info.size > PREVIEW_LIMIT && !type.startsWith('video/') && !type.startsWith('audio/')) return 'none';
  if (type.includes('html') || /\.html?$/.test(name)) return 'html';
  if (type.includes('svg') || /\.svg$/.test(name)) return 'svg';
  if (type.includes('markdown') || /\.mdx?$/.test(name)) return 'markdown';
  if (type.startsWith('text/') || /\.(json|csv|txt|log|ya?ml)$/.test(name)) return 'text';
  if (type.startsWith('image/')) return 'image';
  if (type.includes('pdf')) return 'pdf';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'none';
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <Image src="/logo-icon.png" alt="OpenAgents" width={40} height={40} />
      {children}
    </div>
  );
}

export default function SharedFilePage({ params }: { params: Promise<{ token: string }> }) {
  const t = useT();
  const { formatDateTime, formatFileSize } = useFormatters();
  const { token } = use(params);
  const contentUrl = `${API_URL}/v1/public/files/${encodeURIComponent(token)}/content`;
  const [info, setInfo] = useState<PublicFileInfo | null>(null);
  const [body, setBody] = useState<Body | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let objectUrl: string | undefined;
    const abort = new AbortController();
    (async () => {
      const res = await fetch(`${API_URL}/v1/public/files/${encodeURIComponent(token)}`, { signal: abort.signal, referrerPolicy: 'no-referrer' });
      const json = res.ok ? await res.json() : null;
      if (!json || json.code !== 0) { setError(t('sharedFile.notFound')); return; }
      const meta = json.data as PublicFileInfo;
      setInfo(meta);
      const kind = previewKind(meta);
      if (kind === 'none') { setBody({ kind }); return; }
      if (kind === 'video' || kind === 'audio') { setBody({ kind, url: contentUrl }); return; }
      const content = await fetch(contentUrl, { signal: abort.signal, referrerPolicy: 'no-referrer' });
      if (!content.ok) { setError(t('sharedFile.notFound')); return; }
      if (kind === 'html' || kind === 'svg' || kind === 'markdown' || kind === 'text') {
        setBody({ kind, text: await content.text() });
      } else {
        objectUrl = URL.createObjectURL(await content.blob());
        setBody({ kind, url: objectUrl });
      }
    })().catch(() => { if (!abort.signal.aborted) setError(t('sharedFile.loadFailed')); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, contentUrl, t]);

  const download = async () => {
    if (!info || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(contentUrl, { referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = info.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(t('sharedFile.loadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t('sharedFile.title')}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <a href="https://openagents.org" className="text-sm text-primary hover:underline">{t('shared.goToOpenAgents')}</a>
      </Shell>
    );
  }
  if (!info || !body) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const fills = body.kind === 'svg' || body.kind === 'pdf';
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
        <Image src="/logo-icon.png" alt="OpenAgents" width={24} height={24} />
        <div className="min-w-0 flex-1 text-left">
          <h1 className="truncate text-sm font-semibold" title={info.filename}>{info.filename}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {formatFileSize(info.size)}
            {info.shared_at && ` · ${t('sharedFile.sharedOn', { date: formatDateTime(info.shared_at) })}`}
          </p>
        </div>
        <Button size="sm" onClick={() => void download()} disabled={downloading}>
          {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {t('sharedFile.download')}
        </Button>
      </header>
      <main className={fills ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto'}>
        {body.kind === 'html' && <pre className="mx-auto max-w-5xl whitespace-pre-wrap break-words px-4 py-6 text-sm sm:px-6">{body.text}</pre>}
        {body.kind === 'svg' && <iframe title={info.filename} srcDoc={body.text} sandbox="" referrerPolicy="no-referrer" className="size-full border-0 bg-white" />}
        {body.kind === 'pdf' && <iframe title={info.filename} src={body.url} className="size-full border-0" />}
        {body.kind === 'markdown' && <article className="mx-auto max-w-3xl px-4 py-6 sm:px-6"><MarkdownContent content={body.text} agentNames={[]} /></article>}
        {body.kind === 'text' && <pre className="mx-auto max-w-5xl whitespace-pre-wrap break-words px-4 py-6 text-sm sm:px-6">{body.text}</pre>}
        {body.kind === 'image' && <div className="flex min-h-full items-center justify-center p-4"><img src={body.url} alt={info.filename} className="max-h-full max-w-full object-contain" /></div>}
        {body.kind === 'video' && <div className="flex min-h-full items-center justify-center p-4"><video src={body.url} controls preload="metadata" className="max-h-full max-w-full" /></div>}
        {body.kind === 'audio' && <div className="flex min-h-full items-center justify-center p-4"><audio src={body.url} controls preload="metadata" /></div>}
        {body.kind === 'none' && <Shell><p className="max-w-md text-sm text-muted-foreground">{t('sharedFile.noPreview')}</p></Shell>}
      </main>
    </div>
  );
}
