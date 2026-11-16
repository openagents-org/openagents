import { delimiterFor } from './sheet-stage';
import type { FileKind } from './file-utils';

/** Text we're willing to pull into the browser and lay out. Past this a
 *  preview is slower and less useful than the download button. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Whether a web-kind file is an HTML page the preview can frame. */
export function isHtml(contentType: string, filename: string): boolean {
  return contentType === 'text/html' || /\.html?$/i.test(filename);
}

/**
 * How the preview gets at a file's bytes.
 *
 * `url` hands the download route straight to an <img>/<audio>/<video>/<iframe>
 * (the URL carries the workspace token). `blob` is for PDFs: the route serves
 * them as an attachment, which makes a direct <iframe> download the file
 * instead of rendering it — a blob URL has no disposition, so the browser's
 * built-in viewer takes over.
 */
export type LoadStrategy = 'text' | 'blob' | 'url' | 'none';

export function loadStrategyFor(kind: FileKind, contentType: string, filename: string): LoadStrategy {
  switch (kind) {
    case 'markdown':
    case 'text':
    case 'code':
      return 'text';
    case 'sheet':
      return delimiterFor(contentType, filename) ? 'text' : 'none';
    case 'pdf':
      return 'blob';
    case 'image':
    case 'audio':
    case 'video':
      return 'url';
    case 'web':
      return isHtml(contentType, filename) ? 'url' : 'none';
    default:
      return 'none';
  }
}

/** Hex SHA-256 of the bytes as served — what the save route compares against
 *  to tell whether the file moved on while it was open. Undefined where the
 *  browser has no SubtleCrypto (plain-http origins); the save then skips the check. */
export async function sha256Hex(data: ArrayBuffer): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
