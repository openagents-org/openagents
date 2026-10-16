'use client';

import type { ImgHTMLAttributes } from 'react';
import { AuthenticatedImage } from '@/components/files/authenticated-image';
import { shareOrigin } from '@/lib/share-origin';

const FILE_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const bareFileId = new RegExp(`^${FILE_ID}$`, 'i');
const filePath = new RegExp(`^/v1/files/(${FILE_ID})/?$`, 'i');

/** Agents may embed an upload ID instead of its download URL. Only resolve
 * workspace references; never send viewer credentials to a Markdown URL. */
export function markdownImageFileId(src: string): string | undefined {
  if (bareFileId.test(src)) return src;
  const relative = src.match(filePath);
  if (relative) return relative[1];
  try {
    const origin = typeof window === 'undefined' ? shareOrigin() : window.location.origin;
    const url = new URL(src, origin);
    if (url.origin !== origin && url.origin !== shareOrigin()) return;
    return url.pathname.match(filePath)?.[1];
  } catch { return; }
}

export function MarkdownImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const fileId = typeof src === 'string' ? markdownImageFileId(src) : undefined;
  if (fileId) return <AuthenticatedImage {...props} fileId={fileId} />;
  return <img {...props} src={src} />;
}
