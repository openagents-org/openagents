'use client';
import { useFileObjectUrl } from '@/hooks/use-file-object-url';
import { useT } from '@/lib/i18n';
import type { ImgHTMLAttributes } from 'react';

export function AuthenticatedImage({ fileId, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fileId: string }) {
  const { url, failed } = useFileObjectUrl(fileId);
  const t = useT();
  if (failed) return <span className="p-3 text-xs text-muted-foreground" role="status">{t('files.loadFailed')}</span>;
  if (!url) return <span className="block h-20 w-32 animate-pulse rounded bg-muted" aria-label={t('common.loading')} />;
  return <img {...props} src={url} />;
}
