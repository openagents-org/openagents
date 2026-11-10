'use client';
import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { useFileObjectUrl } from '@/hooks/use-file-object-url';
import { useT } from '@/lib/i18n';

/**
 * `deferUntilVisible` holds the download until the placeholder nears the
 * viewport — `loading="lazy"` only defers the <img>, which comes after the
 * fetch, so a grid of thumbnails would otherwise download every image at once.
 */
export function AuthenticatedImage({ fileId, deferUntilVisible = false, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fileId: string; deferUntilVisible?: boolean }) {
  const [visible, setVisible] = useState(!deferUntilVisible);
  const placeholder = useRef<HTMLSpanElement>(null);
  const { url, failed } = useFileObjectUrl(fileId, { enabled: visible });
  const t = useT();
  useEffect(() => {
    const el = placeholder.current;
    if (visible || !el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '300px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, url]);
  if (failed) return <span className="p-3 text-xs text-muted-foreground" role="status">{t('files.loadFailed')}</span>;
  if (!url) return <span ref={placeholder} className="block h-20 w-32 animate-pulse rounded bg-muted" aria-label={t('common.loading')} />;
  return <img {...props} src={url} />;
}
