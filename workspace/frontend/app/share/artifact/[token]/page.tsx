'use client';

/**
 * /share/artifact/<token> — a thread artifact someone shared with "anyone
 * with the link": a copy of a file, web project or knowledge document taken
 * when the link was made. No sign-in and no workspace: the token is the whole
 * credential.
 *
 * Anyone can share anything here, under our domain, so nothing shared may act
 * like a page of ours. An HTML page or web project renders only from the
 * separate share domain (`render_url`), in a sandboxed frame whose content
 * cannot fetch or submit anything outside its own copy, under a banner saying
 * who made it; with no share domain configured, HTML is shown as its source.
 * SVG is drawn in an iframe with every sandbox restriction on, not from a blob
 * URL that would run its script in our origin if opened in a tab. Audio and
 * video stream from the API (it answers range requests, so they seek) instead
 * of being downloaded whole first. No request carries a referrer (layout.tsx).
 */

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { Download, ExternalLink, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { SheetStage, delimiterFor } from '@/components/files/sheet-stage';
import { getApiBaseUrl } from '@/lib/api-base';
import { useFormatters, useT } from '@/lib/i18n';
import { withSharedAssets } from '@/lib/share-origin';
import type { PublicShareInfo } from '@/lib/types';

const API_URL = getApiBaseUrl();
/** Past this, text kinds are offered as a download instead of a preview. */
const PREVIEW_LIMIT = 20 * 1024 * 1024;

type Body =
  | { kind: 'html' | 'svg' | 'markdown' | 'text'; text: string }
  | { kind: 'sheet'; text: string; delimiter: string }
  | { kind: 'image' | 'pdf' | 'video' | 'audio' | 'page'; url: string }
  | { kind: 'project' | 'none' };

function previewKind(info: PublicShareInfo): Body['kind'] {
  const type = (info.content_type || '').toLowerCase();
  const name = info.title.toLowerCase();
  if (info.render_url) return 'page';
  if (info.web_project) return 'project';
  if (info.size > PREVIEW_LIMIT && !type.startsWith('video/') && !type.startsWith('audio/')) return 'none';
  if (type.includes('html') || /\.html?$/.test(name)) return 'html';
  if (type.includes('svg') || /\.svg$/.test(name)) return 'svg';
  if (info.kind === 'knowledge' || type.includes('markdown') || /\.mdx?$/.test(name)) return 'markdown';
  if (delimiterFor(type, name)) return 'sheet';
  if (type.startsWith('text/') || /\.(json|txt|log|ya?ml)$/.test(name)) return 'text';
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

export default function SharedArtifactPage({ params }: { params: Promise<{ token: string }> }) {
  const t = useT();
  const { formatDate, formatDateTime, formatFileSize } = useFormatters();
  const { token } = use(params);
  const base = `${API_URL}/v1/public/shares/${encodeURIComponent(token)}`;
  const contentUrl = `${base}/content`;
  const [info, setInfo] = useState<PublicShareInfo | null>(null);
  const [body, setBody] = useState<Body | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let objectUrl: string | undefined;
    const abort = new AbortController();
    (async () => {
      const res = await fetch(base, { signal: abort.signal, referrerPolicy: 'no-referrer' });
      const json = await res.json().catch(() => null);
      if (!json || json.code !== 0) {
        setError(/expired/i.test(json?.message || '') ? t('sharedFile.expired') : t('sharedFile.notFound'));
        return;
      }
      const meta = json.data as PublicShareInfo;
      setInfo(meta);
      const kind = previewKind(meta);
      if (kind === 'none' || kind === 'project') { setBody({ kind }); return; }
      if (kind === 'page') { setBody({ kind, url: meta.render_url! }); return; }
      if (kind === 'video' || kind === 'audio') { setBody({ kind, url: contentUrl }); return; }
      const content = await fetch(contentUrl, { signal: abort.signal, referrerPolicy: 'no-referrer' });
      if (!content.ok) { setError(t('sharedFile.notFound')); return; }
      if (kind === 'sheet') {
        setBody({ kind, text: await content.text(), delimiter: delimiterFor((meta.content_type || '').toLowerCase(), meta.title.toLowerCase()) || ',' });
      } else if (kind === 'markdown') {
        setBody({ kind, text: withSharedAssets(await content.text(), `${base}/assets`) });
      } else if (kind === 'html' || kind === 'svg' || kind === 'text') {
        setBody({ kind, text: await content.text() });
      } else {
        objectUrl = URL.createObjectURL(await content.blob());
        setBody({ kind, url: objectUrl });
      }
    })().catch(() => { if (!abort.signal.aborted) setError(t('sharedFile.loadFailed')); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [base, contentUrl, t]);

  const filename = info ? (info.kind === 'knowledge' ? `${info.title}.md` : info.title) : '';
  const download = async () => {
    if (!info || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(contentUrl, { referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
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

  const fills = body.kind === 'svg' || body.kind === 'pdf' || body.kind === 'page';
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
        <Image src="/logo-icon.png" alt="OpenAgents" width={24} height={24} />
        <div className="min-w-0 flex-1 text-left">
          <h1 className="truncate text-sm font-semibold" title={info.title}>{info.title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {formatFileSize(info.size)}
            {info.shared_at && ` · ${t('sharedFile.sharedOn', { date: formatDateTime(info.shared_at) })}`}
            {info.expires_at && ` · ${t('sharedFile.expiresOn', { date: formatDate(info.expires_at) })}`}
          </p>
        </div>
        {body.kind === 'page' && (
          <Button size="sm" variant="outline" asChild>
            <a href={body.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" />{t('sharedFile.openPage')}</a>
          </Button>
        )}
        <Button size="sm" onClick={() => void download()} disabled={downloading}>
          {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {t('sharedFile.download')}
        </Button>
      </header>
      {body.kind === 'page' && (
        <p className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6 dark:bg-amber-950/40 dark:text-amber-200" data-testid="shared-user-content">
          <ShieldAlert className="size-3.5 shrink-0" />{t('sharedFile.userContent')}
        </p>
      )}
      <main className={fills ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto'}>
        {body.kind === 'page' && <iframe title={info.title} src={body.url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="size-full border-0 bg-white" />}
        {body.kind === 'html' && <pre className="mx-auto max-w-5xl whitespace-pre-wrap break-words px-4 py-6 text-sm sm:px-6">{body.text}</pre>}
        {body.kind === 'svg' && <iframe title={info.title} srcDoc={body.text} sandbox="" referrerPolicy="no-referrer" className="size-full border-0 bg-white" />}
        {body.kind === 'pdf' && <iframe title={info.title} src={body.url} className="size-full border-0" />}
        {body.kind === 'markdown' && <article className="mx-auto max-w-3xl px-4 py-6 sm:px-6"><MarkdownContent content={body.text} agentNames={[]} /></article>}
        {body.kind === 'sheet' && <SheetStage content={body.text} delimiter={body.delimiter} />}
        {body.kind === 'text' && <pre className="mx-auto max-w-5xl whitespace-pre-wrap break-words px-4 py-6 text-sm sm:px-6">{body.text}</pre>}
        {body.kind === 'image' && <div className="flex min-h-full items-center justify-center p-4"><img src={body.url} alt={info.title} className="max-h-full max-w-full object-contain" /></div>}
        {body.kind === 'video' && <div className="flex min-h-full items-center justify-center p-4"><video src={body.url} controls preload="metadata" className="max-h-full max-w-full" /></div>}
        {body.kind === 'audio' && <div className="flex min-h-full items-center justify-center p-4"><audio src={body.url} controls preload="metadata" /></div>}
        {body.kind === 'project' && <Shell><p className="max-w-md text-sm text-muted-foreground">{t('sharedFile.renderUnavailable')}</p></Shell>}
        {body.kind === 'none' && <Shell><p className="max-w-md text-sm text-muted-foreground">{t('sharedFile.noPreview')}</p></Shell>}
      </main>
    </div>
  );
}
