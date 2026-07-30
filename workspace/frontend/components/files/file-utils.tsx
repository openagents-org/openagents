'use client';

import { useState, type ReactNode } from 'react';
import {
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
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

/** What the Files grid can be filtered down to — a type, folders, or nothing. */
export type FileTypeFilter = FileFilterGroup | 'folders' | 'all';

/** What it can be ordered by. */
export type FileSortKey = 'name' | 'recent' | 'size';

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

/** Amber, the same colour the folder panel uses for its rows. */
const FOLDER_COLOR = '#f59e0b';

/**
 * A folder in the grid. It takes the same 76px slot as a file tile so the two
 * sit in one grid without knocking the rows out of line, and wears the panel's
 * amber so the thing you clicked on the left is recognisably the same thing.
 */
export function FolderTile({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-19 w-15 shrink-0 items-center justify-center rounded-xl border border-border/70 shadow-xs transition-transform',
        className,
      )}
      style={{
        background: `linear-gradient(155deg, color-mix(in oklab, ${FOLDER_COLOR} 18%, transparent), color-mix(in oklab, ${FOLDER_COLOR} 6%, transparent))`,
      }}
    >
      <Folder className="size-8" style={{ color: FOLDER_COLOR }} />
    </div>
  );
}

/** Row-height folder icon, matching {@link FileRowIcon}'s slot in list view. */
export function FolderRowIcon({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60',
        className,
      )}
      style={{ background: `color-mix(in oklab, ${FOLDER_COLOR} 12%, transparent)` }}
    >
      <Folder className="size-4" style={{ color: FOLDER_COLOR }} />
    </div>
  );
}

/** "3 folders · 12 files", or "Empty" when there's nothing to say. */
export function describeFolder(entry: FolderEntry): string {
  const parts: string[] = [];
  if (entry.folderCount) {
    parts.push(`${entry.folderCount} ${entry.folderCount === 1 ? 'folder' : 'folders'}`);
  }
  if (entry.fileCount) {
    parts.push(`${entry.fileCount} ${entry.fileCount === 1 ? 'file' : 'files'}`);
  }
  return parts.join(' · ') || 'Empty';
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

/**
 * What a thumbnail needs to know about a file.
 *
 * Narrower than `WorkspaceFile` on purpose: a trash row carries these four
 * fields and nothing else, and its images deserve pixels for the same reason
 * the grid's do — that's when you're deciding whether to restore it.
 */
export interface ThumbnailSource {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

/** Whether this file can stand in for itself, rather than for its type. */
export function canThumbnail(file: ThumbnailSource): boolean {
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
 * The image, filling whatever box the caller reserved, with the file's own type
 * tile standing in until it decodes and for good if it never does.
 *
 * The stand-in matters more than it sounds: there's no resizing endpoint, so a
 * 5MB screenshot is 5MB on the wire to draw 76 pixels, and for those seconds
 * the tile is all there is. An empty tinted box for that long reads as a file
 * that failed, so the wait shows the same tile a non-image gets — the kind,
 * the extension, a slow pulse — and the picture fades in over it. Nothing
 * moves when it arrives; the box was always the right size.
 *
 * Callers pass the box size in `className` rather than getting it from here:
 * the stand-in has to occupy exactly the same space, and only the caller knows
 * what that is.
 */
function FileThumbnail({
  file,
  className,
  fallback,
  placeholder,
}: {
  file: ThumbnailSource;
  className?: string;
  /** Shown instead of the box when the image will never arrive. */
  fallback: ReactNode;
  /** Shown inside the box until it does. */
  placeholder: ReactNode;
}) {
  const [broken, setBroken] = useState(() => brokenThumbnails.has(file.id));
  const [loaded, setLoaded] = useState(false);
  const { color } = getFileTypeMeta(file.contentType, file.filename);

  if (broken) return <>{fallback}</>;

  return (
    <span
      className={cn(
        'relative block overflow-hidden',
        className,
        // Until there are pixels, the box is only a frame around the stand-in:
        // its own border and tint would read as a second, empty tile.
        !loaded && 'border-transparent shadow-none',
      )}
      // Tinted behind the image, which is what a transparent PNG sits on.
      style={loaded ? { background: `color-mix(in oklab, ${color} 12%, transparent)` } : undefined}
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
      {!loaded && (
        <span
          className="absolute inset-0 flex animate-pulse items-center justify-center"
          aria-hidden
        >
          {placeholder}
        </span>
      )}
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
  // The caller's className carries the hover lift, which belongs to whichever
  // element is the tile: the type tile when it stands alone, the frame when it
  // holds one. Handing it to both would lift twice.
  const tile = (tileClassName?: string) => (
    <FileTypeTile
      contentType={file.contentType}
      filename={file.filename}
      className={tileClassName}
    />
  );

  if (!canThumbnail(file)) return tile(className);

  return (
    <FileThumbnail
      // Keyed so a recycled slot can't keep the previous file's loaded or
      // broken verdict.
      key={file.id}
      file={file}
      fallback={tile(className)}
      placeholder={tile()}
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
export function FileRowIcon({ file, className }: { file: ThumbnailSource; className?: string }) {
  const glyph = (glyphClassName?: string) => (
    <span className={cn('flex size-7 shrink-0 items-center justify-center', glyphClassName)}>
      {getFileIcon(file.contentType, file.filename)}
    </span>
  );

  if (!canThumbnail(file)) return glyph(className);

  return (
    <FileThumbnail
      key={file.id}
      file={file}
      fallback={glyph(className)}
      placeholder={glyph()}
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

export interface FolderEntry {
  type: 'folder';
  /** Full path from the root, which is what selecting it navigates to */
  path: string;
  name: string;
  /** Files anywhere below it — what you'd find if you kept opening it */
  fileCount: number;
  /** Direct subfolders, so a folder of folders doesn't read as empty */
  folderCount: number;
  /** Total bytes in the folder subtree, used when sorting folders by size */
  totalSize: number;
  /** Newest item in the folder subtree, used as the folder's modified time */
  modifiedAt: string | null;
}

/**
 * Every file at or below `path`, named relative to it.
 *
 * Used for search, which spans folders and so has to say which one each hit
 * came from. Browsing uses {@link getFolderContents} instead — one level at a
 * time, the way the folder was built.
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

/**
 * Every folder represented by the file-path prefixes in the workspace.
 *
 * Folder metadata is aggregated over the whole subtree. This gives folder
 * sorting useful semantics even though folders are virtual and do not have
 * their own size or modified timestamp in the API.
 */
export function getAllFolders(files: WorkspaceFile[]): FolderEntry[] {
  const folders = new Map<string, FolderEntry>();
  const childFolders = new Map<string, Set<string>>();

  for (const file of files) {
    const directory = dirname(file.filename);
    if (!directory) continue;

    const segments = directory.split('/');
    const isKeep = basename(file.filename) === '.keep';
    const createdAtMs = file.createdAt ? new Date(file.createdAt).getTime() : 0;

    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join('/');
      let entry = folders.get(path);
      if (!entry) {
        entry = {
          type: 'folder',
          path,
          name: segments[i],
          fileCount: 0,
          folderCount: 0,
          totalSize: 0,
          modifiedAt: null,
        };
        folders.set(path, entry);
        childFolders.set(path, new Set());
      }

      if (!isKeep) {
        entry.fileCount += 1;
        entry.totalSize += file.size;
      }

      const previousMs = entry.modifiedAt ? new Date(entry.modifiedAt).getTime() : 0;
      if (createdAtMs > previousMs) entry.modifiedAt = file.createdAt;

      if (i < segments.length - 1) {
        childFolders.get(path)!.add(segments[i + 1]);
      }
    }
  }

  childFolders.forEach((children, path) => {
    folders.get(path)!.folderCount = children.size;
  });

  return Array.from(folders.values());
}

/**
 * What's directly inside `path`: its subfolders, and the files sitting in it.
 *
 * One level only. Flattening a folder's descendants into its own listing puts
 * files somewhere they aren't — the folder you're looking at stops matching
 * what it holds, and dragging a file "out" of a subfolder you can't see isn't
 * a thing you can do.
 */
export function getFolderContents(
  files: WorkspaceFile[],
  path: string,
): { folders: FolderEntry[]; files: FileEntry[] } {
  const prefix = path ? `${path}/` : '';
  const directFiles: FileEntry[] = [];

  for (const file of files) {
    if (prefix && !file.filename.startsWith(prefix)) continue;
    const relative = prefix ? file.filename.slice(prefix.length) : file.filename;
    const slash = relative.indexOf('/');

    if (slash === -1) {
      // `.keep` only exists to give an empty folder something to be
      if (relative === '.keep') continue;
      directFiles.push({ type: 'file', file, displayName: relative });
    }
  }

  const folders = getAllFolders(files)
    .filter((folder) => dirname(folder.path) === path)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    folders,
    files: directFiles,
  };
}
