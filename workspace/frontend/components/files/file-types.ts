import { WEB_PROJECT_TYPE } from '@/lib/web-projects';
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
import type { MessageKey } from '@/lib/i18n';

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
  /**
   * Message key for the spelled-out name, used where a glyph alone won't do
   * (unsupported states). Callers resolve it with `t()`.
   */
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Accent colour, as a CSS custom property declared in styles/globals.css */
  color: string;
}

export const FILE_TYPES: Record<FileKind, FileTypeMeta> = {
  pdf: { kind: 'pdf', labelKey: 'files.kindPdf', icon: FileText, color: 'var(--file-pdf)' },
  doc: { kind: 'doc', labelKey: 'files.kindDoc', icon: FileText, color: 'var(--file-doc)' },
  sheet: { kind: 'sheet', labelKey: 'files.kindSheet', icon: FileSpreadsheet, color: 'var(--file-sheet)' },
  slides: { kind: 'slides', labelKey: 'files.kindSlides', icon: Presentation, color: 'var(--file-slides)' },
  markdown: { kind: 'markdown', labelKey: 'files.kindMarkdown', icon: FileText, color: 'var(--file-markdown)' },
  text: { kind: 'text', labelKey: 'files.kindText', icon: FileIcon, color: 'var(--file-text)' },
  code: { kind: 'code', labelKey: 'files.kindCode', icon: FileCode, color: 'var(--file-code)' },
  image: { kind: 'image', labelKey: 'files.kindImage', icon: ImageIcon, color: 'var(--file-image)' },
  audio: { kind: 'audio', labelKey: 'files.kindAudio', icon: Music, color: 'var(--file-audio)' },
  video: { kind: 'video', labelKey: 'files.kindVideo', icon: Video, color: 'var(--file-video)' },
  web: { kind: 'web', labelKey: 'files.kindWeb', icon: Globe, color: 'var(--file-web)' },
  archive: { kind: 'archive', labelKey: 'files.kindArchive', icon: FileArchive, color: 'var(--file-archive)' },
  unknown: { kind: 'unknown', labelKey: 'files.kindUnknown', icon: FileIcon, color: 'var(--file-unknown)' },
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
export function extensionOf(filename: string): string {
  const base = filename.split('/').pop() || filename;
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

/** Resolve a file to its kind — extension first, content type as the fallback. */
export function getFileKind(contentType: string | undefined, filename: string): FileKind {
  if (contentType === WEB_PROJECT_TYPE) return 'web';
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
  if (contentType === WEB_PROJECT_TYPE) return {...FILE_TYPES.web, icon:Folder, labelKey:'webProject.kind'};
  return FILE_TYPES[getFileKind(contentType, filename)];
}

/* ── Filter groups ───────────────────────────────────────────────────────────
 * Kinds are how a file is drawn; groups are how it's looked for. Nobody hunts
 * for "the .txt one" — they hunt for a document — so several kinds collapse
 * onto one line in the type filter.
 * ──────────────────────────────────────────────────────────────────────────── */

export type FileFilterGroup =
  | 'documents'
  | 'pdf'
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
  labelKey: MessageKey;
  kinds: FileKind[];
  icon: LucideIcon;
  color: string;
}

/** What the Files grid can be filtered down to — a type, folders, or nothing. */
export type FileTypeFilter = FileFilterGroup | 'folders' | 'all';

/** What it can be ordered by. */
export type FileSortKey = 'name' | 'recent' | 'size';

export const FILE_FILTER_GROUPS: FileFilterGroupMeta[] = [
  { id: 'web', labelKey: 'files.groupWeb', kinds: ['web'], icon: Globe, color: 'var(--file-web)' },
  { id: 'documents', labelKey: 'files.groupDocuments', kinds: ['doc', 'markdown', 'text'], icon: FileText, color: 'var(--file-doc)' },
  { id: 'pdf', labelKey: 'files.groupPdf', kinds: ['pdf'], icon: FileText, color: 'var(--file-pdf)' },
  { id: 'sheets', labelKey: 'files.groupSheets', kinds: ['sheet'], icon: FileSpreadsheet, color: 'var(--file-sheet)' },
  { id: 'slides', labelKey: 'files.groupSlides', kinds: ['slides'], icon: Presentation, color: 'var(--file-slides)' },
  { id: 'images', labelKey: 'files.groupImages', kinds: ['image'], icon: ImageIcon, color: 'var(--file-image)' },
  { id: 'audio', labelKey: 'files.groupAudio', kinds: ['audio'], icon: Music, color: 'var(--file-audio)' },
  { id: 'video', labelKey: 'files.groupVideo', kinds: ['video'], icon: Video, color: 'var(--file-video)' },
  { id: 'code', labelKey: 'files.groupCode', kinds: ['code'], icon: FileCode, color: 'var(--file-code)' },
  { id: 'archives', labelKey: 'files.groupArchives', kinds: ['archive'], icon: FileArchive, color: 'var(--file-archive)' },
  { id: 'other', labelKey: 'files.groupOther', kinds: ['unknown'], icon: FileIcon, color: 'var(--file-unknown)' },
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
  if (filename.endsWith('.webproject.zip') || /^https?:\/\//i.test(filename)) return 'WEB';
  const ext = extensionOf(filename);
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE';
}
