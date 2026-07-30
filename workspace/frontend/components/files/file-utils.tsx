'use client';

import { useState, type ReactNode } from 'react';
import {
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  Music,
  Presentation,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceFile } from '@/lib/types';
import { cn } from '@/lib/utils';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * File types
 *
 * Every file the workspace can hold collapses to one of these kinds. The kind
 * is the single source of truth for three things that used to be decided
 * separately and drift apart: which glyph a file gets, which accent colour it
 * wears, and how the preview pane renders it.
 * ──────────────────────────────────────────────────────────────────────────── */

export type FileKind =
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'markdown'
  | 'text'
  | 'code'
  | 'image'
  | 'audio'
  | 'video'
  | 'web'
  | 'archive'
  | 'unknown';

export interface FileTypeMeta {
  kind: FileKind;
  /** Spelled-out name, used where a glyph alone won't do (unsupported states) */
  label: string;
  icon: LucideIcon;
  /** Accent colour, as a CSS custom property declared in styles/globals.css */
  color: string;
}

export const FILE_TYPES: Record<FileKind, FileTypeMeta> = {
  pdf: { kind: 'pdf', label: 'PDF document', icon: FileText, color: 'var(--file-pdf)' },
  doc: { kind: 'doc', label: 'Word document', icon: FileText, color: 'var(--file-doc)' },
  sheet: { kind: 'sheet', label: 'Spreadsheet', icon: FileSpreadsheet, color: 'var(--file-sheet)' },
  slides: { kind: 'slides', label: 'Presentation', icon: Presentation, color: 'var(--file-slides)' },
  markdown: { kind: 'markdown', label: 'Markdown', icon: FileText, color: 'var(--file-markdown)' },
  text: { kind: 'text', label: 'Text file', icon: FileIcon, color: 'var(--file-text)' },
  code: { kind: 'code', label: 'Source file', icon: FileCode, color: 'var(--file-code)' },
  image: { kind: 'image', label: 'Image', icon: ImageIcon, color: 'var(--file-image)' },
  audio: { kind: 'audio', label: 'Audio', icon: Music, color: 'var(--file-audio)' },
  video: { kind: 'video', label: 'Video', icon: Video, color: 'var(--file-video)' },
  web: { kind: 'web', label: 'Web page', icon: Globe, color: 'var(--file-web)' },
  archive: { kind: 'archive', label: 'Archive', icon: FileArchive, color: 'var(--file-archive)' },
  unknown: { kind: 'unknown', label: 'File', icon: FileIcon, color: 'var(--file-unknown)' },
};

/** Extension → kind. Extensions win over content type: uploads routinely
 *  arrive as application/octet-stream, and the name is what the user sees. */
const EXTENSION_KINDS: Record<string, FileKind> = {
  pdf: 'pdf',

  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', pages: 'doc',

  xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet',

  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',

  md: 'markdown', markdown: 'markdown', mdx: 'markdown',

  txt: 'text', log: 'text', text: 'text',

  js: 'code', mjs: 'code', cjs: 'code', jsx: 'code', ts: 'code', tsx: 'code',
  py: 'code', rb: 'code', rs: 'code', go: 'code', java: 'code', kt: 'code',
  c: 'code', h: 'code', cpp: 'code', hpp: 'code', cs: 'code', swift: 'code',
  php: 'code', sh: 'code', bash: 'code', zsh: 'code', sql: 'code', r: 'code',
  json: 'code', yaml: 'code', yml: 'code', toml: 'code', xml: 'code',
  ini: 'code', cfg: 'code', conf: 'code', env: 'code',
  css: 'code', scss: 'code', less: 'code', vue: 'code', svelte: 'code', ipynb: 'code',

  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  svg: 'image', bmp: 'image', ico: 'image', avif: 'image', heic: 'image', tiff: 'image',

  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',

  mp4: 'video', mov: 'video', avi: 'video', webm: 'video', mkv: 'video', m4v: 'video',

  html: 'web', htm: 'web', url: 'web',

  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive',
  rar: 'archive', '7z': 'archive', bz2: 'archive', xz: 'archive',
};

/** Lowercased extension without the dot — '' when the name has none. */
function extensionOf(filename: string): string {
  const base = filename.split('/').pop() || filename;
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

/** Resolve a file to its kind — extension first, content type as the fallback. */
export function getFileKind(contentType: string | undefined, filename: string): FileKind {
  const name = filename || '';
  if (/^https?:\/\//i.test(name)) return 'web';

  const byExtension = EXTENSION_KINDS[extensionOf(name)];
  if (byExtension) return byExtension;

  const ct = (contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.startsWith('video/')) return 'video';
  if (ct === 'application/pdf') return 'pdf';
  if (ct === 'text/html') return 'web';
  if (ct === 'text/markdown') return 'markdown';
  if (ct === 'text/csv' || ct.includes('spreadsheet') || ct.includes('excel')) return 'sheet';
  if (ct.includes('presentation') || ct.includes('powerpoint')) return 'slides';
  if (ct.includes('word') || ct === 'application/rtf') return 'doc';
  if (ct.includes('zip') || ct.includes('compressed') || ct.includes('tar')) return 'archive';
  if (ct.includes('json') || ct.includes('javascript') || ct.includes('xml') || ct.includes('yaml')) return 'code';
  if (ct.startsWith('text/')) return 'text';

  return 'unknown';
}

export function getFileTypeMeta(contentType: string | undefined, filename: string): FileTypeMeta {
  return FILE_TYPES[getFileKind(contentType, filename)];
}

/* ── Filter groups ───────────────────────────────────────────────────────────
 * Kinds are how a file is drawn; groups are how it's looked for. Nobody hunts
 * for "the .txt one" — they hunt for a document — so several kinds collapse
 * onto one line in the type filter.
 * ──────────────────────────────────────────────────────────────────────────── */

export type FileFilterGroup =
  | 'documents'
  | 'sheets'
  | 'slides'
  | 'images'
  | 'audio'
  | 'video'
  | 'code'
  | 'web'
  | 'archives'
  | 'other';

export interface FileFilterGroupMeta {
  id: FileFilterGroup;
  label: string;
  kinds: FileKind[];
  icon: LucideIcon;
  color: string;
}

export const FILE_FILTER_GROUPS: FileFilterGroupMeta[] = [
  { id: 'documents', label: 'Documents', kinds: ['pdf', 'doc', 'markdown', 'text'], icon: FileText, color: 'var(--file-doc)' },
  { id: 'sheets', label: 'Spreadsheets', kinds: ['sheet'], icon: FileSpreadsheet, color: 'var(--file-sheet)' },
  { id: 'slides', label: 'Presentations', kinds: ['slides'], icon: Presentation, color: 'var(--file-slides)' },
  { id: 'images', label: 'Images', kinds: ['image'], icon: ImageIcon, color: 'var(--file-image)' },
  { id: 'audio', label: 'Audio', kinds: ['audio'], icon: Music, color: 'var(--file-audio)' },
  { id: 'video', label: 'Video', kinds: ['video'], icon: Video, color: 'var(--file-video)' },
  { id: 'code', label: 'Code', kinds: ['code'], icon: FileCode, color: 'var(--file-code)' },
  { id: 'web', label: 'Web pages', kinds: ['web'], icon: Globe, color: 'var(--file-web)' },
  { id: 'archives', label: 'Archives', kinds: ['archive'], icon: FileArchive, color: 'var(--file-archive)' },
  { id: 'other', label: 'Other', kinds: ['unknown'], icon: FileIcon, color: 'var(--file-unknown)' },
];

const KIND_TO_GROUP = FILE_FILTER_GROUPS.reduce((acc, group) => {
  for (const kind of group.kinds) acc[kind] = group.id;
  return acc;
}, {} as Record<FileKind, FileFilterGroup>);

export function getFileFilterGroup(contentType: string | undefined, filename: string): FileFilterGroup {
  return KIND_TO_GROUP[getFileKind(contentType, filename)];
}

/** Short uppercase badge for a file — 'PDF', 'PNG', 'WEB', … */
export function getFileExtensionLabel(filename: string): string {
  if (/^https?:\/\//i.test(filename)) return 'WEB';
  const ext = extensionOf(filename);
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE';
}

/** Row-sized icon for lists, breadcrumbs and the ⌘K palette. */
export function getFileIcon(contentType: string | undefined, filename: string, className?: string) {
  const { icon: Icon, color } = getFileTypeMeta(contentType, filename);
  return <Icon className={cn('size-4 shrink-0', className)} style={{ color }} />;
}

/** Bare large icon — for preview placeholders, where the tile would be noise. */
export function getFileIconLarge(contentType: string | undefined, filename: string, className?: string) {
  const { icon: Icon, color } = getFileTypeMeta(contentType, filename);
  return <Icon className={cn('size-10 shrink-0', className)} style={{ color }} />;
}

/**
 * The grid's file card: a sheet-shaped tile tinted with the type's accent,
 * the glyph in the middle and the extension spelled out at the bottom. The
 * badge matters because the glyph is shared — a .docx and a .pages are both
 * "document", and only the badge tells you which one you're about to open.
 */
export function FileTypeTile({
  contentType,
  filename,
  className,
}: {
  contentType: string | undefined;
  filename: string;
  className?: string;
}) {
  const { icon: Icon, color } = getFileTypeMeta(contentType, filename);
  const extension = getFileExtensionLabel(filename);

  return (
    <div
      className={cn(
        'relative flex h-19 w-15 shrink-0 flex-col items-center justify-center rounded-xl border border-border/70 shadow-xs transition-transform',
        className,
      )}
      style={{
        background: `linear-gradient(155deg, color-mix(in oklab, ${color} 16%, transparent), color-mix(in oklab, ${color} 5%, transparent))`,
      }}
    >
      <Icon className="size-7 -translate-y-1" style={{ color }} />
      <span
        className="absolute inset-x-1.5 bottom-1.5 truncate rounded-sm bg-background/70 px-1 py-px text-center text-[9px] leading-tight font-semibold tracking-wide"
        style={{ color }}
      >
        {extension}
      </span>
    </div>
  );
}

/* ── Thumbnails ──────────────────────────────────────────────────────────────
 * An image is the one kind whose glyph tells you nothing: a folder of
 * screenshots is a dozen identical tiles until you can see them. So an image
 * shows its own pixels wherever the layout has room, and every other kind keeps
 * the glyph.
 *
 * There is no resizing endpoint — the thumbnail is the whole file, fetched off
 * the same download route the preview uses. That's what the guards below are
 * for: a format the browser can decode, a size worth spending, and lazy
 * loading so only the tiles you scroll past cost anything.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Formats every browser we target can decode. HEIC and TIFF are images by
 *  kind, badge and filter, but Chrome and Firefox render nothing for them, so
 *  they keep the glyph instead of showing an empty frame. */
const THUMBNAIL_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
]);

/** Past this we'd be pulling megabytes over the wire to draw 76 pixels. */
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/**
 * Files whose thumbnail failed — bytes missing from storage, or a format the
 * browser gave up on. Kept module-wide so scrolling back to a broken tile
 * doesn't re-request it; a fresh page load retries.
 */
const brokenThumbnails = new Set<string>();

/** Whether this file can stand in for itself, rather than for its type. */
export function canThumbnail(file: WorkspaceFile): boolean {
  if (getFileKind(file.contentType, file.filename) !== 'image') return false;
  if (file.size > MAX_THUMBNAIL_BYTES) return false;

  const extension = extensionOf(file.filename);
  if (extension) return THUMBNAIL_EXTENSIONS.has(extension);

  // Extensionless uploads fall back to the content type, minus the formats
  // ruled out above.
  const ct = (file.contentType || '').toLowerCase();
  return ct.startsWith('image/') && !/heic|heif|tiff?/.test(ct);
}

/**
 * The image, filling whatever box the caller reserved, with `fallback` standing
 * in until it decodes and for good if it never does.
 *
 * Callers pass the box size in `className` rather than getting it from here:
 * the fallback has to occupy exactly the same space, and only the caller knows
 * what that is.
 */
function FileThumbnail({
  file,
  className,
  fallback,
}: {
  file: WorkspaceFile;
  className?: string;
  fallback: ReactNode;
}) {
  const [broken, setBroken] = useState(() => brokenThumbnails.has(file.id));
  const [loaded, setLoaded] = useState(false);
  const { color } = getFileTypeMeta(file.contentType, file.filename);

  if (broken) return <>{fallback}</>;

  return (
    <span
      className={cn('relative block overflow-hidden', className)}
      // Tinted while it loads: an empty grey box in a grid of coloured tiles
      // reads as a broken image, and this one is about to hold a picture.
      style={{ background: `color-mix(in oklab, ${color} 12%, transparent)` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={workspaceApi.getFileUrl(file.id)}
        // Decorative: the filename sits right beside it in every caller.
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          brokenThumbnails.add(file.id);
          setBroken(true);
        }}
        className={cn(
          'size-full object-cover transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}

/**
 * The grid's file visual: an image's thumbnail, or its type tile.
 *
 * Both fill the same square slot, so mixed types keep the grid's rhythm and a
 * thumbnail arriving late doesn't reflow anything. Images are centre-cropped
 * rather than fitted — at this size you're recognising a picture, not reading
 * it, and one letterboxed tile beside a full one reads as a layout bug.
 */
export function FileTile({ file, className }: { file: WorkspaceFile; className?: string }) {
  const tile = (
    <FileTypeTile
      contentType={file.contentType}
      filename={file.filename}
      className={className}
    />
  );

  if (!canThumbnail(file)) return tile;

  return (
    <FileThumbnail
      // Keyed so a recycled slot can't keep the previous file's loaded or
      // broken verdict.
      key={file.id}
      file={file}
      fallback={tile}
      className={cn(
        'size-19 rounded-xl border border-border/70 shadow-xs transition-transform',
        className,
      )}
    />
  );
}

/**
 * A list row's leading square — thumbnail or glyph, both 28px, so every name in
 * the list starts on the same edge whatever the row holds.
 */
export function FileRowIcon({ file, className }: { file: WorkspaceFile; className?: string }) {
  const glyph = (
    <span className={cn('flex size-7 shrink-0 items-center justify-center', className)}>
      {getFileIcon(file.contentType, file.filename)}
    </span>
  );

  if (!canThumbnail(file)) return glyph;

  return (
    <FileThumbnail
      key={file.id}
      file={file}
      fallback={glyph}
      className={cn('size-7 shrink-0 rounded-md border border-border/60', className)}
    />
  );
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Get the basename of a path (last segment after /) */
export function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** The folder a path lives in — '' for a file sitting at the root. */
export function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export interface FileEntry {
  type: 'file';
  file: WorkspaceFile;
  displayName: string;
}

/**
 * Every file at or below `path`, named relative to it.
 *
 * The detail pane lists files, never folders — the folder panel owns the
 * hierarchy — so picking a folder means "everything under here", and the
 * subfolder stays in the name to say where each file came from.
 */
export function getFilesUnderPath(files: WorkspaceFile[], path: string): FileEntry[] {
  const prefix = path ? `${path}/` : '';
  const entries: FileEntry[] = [];

  for (const file of files) {
    if (prefix && !file.filename.startsWith(prefix)) continue;
    const relative = prefix ? file.filename.slice(prefix.length) : file.filename;
    if (basename(relative) === '.keep') continue;
    entries.push({ type: 'file', file, displayName: relative });
  }

  return entries;
}
