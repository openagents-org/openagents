'use client';

import { useState, type ReactNode } from 'react';
import { Folder } from 'lucide-react';
import { WEB_PROJECT_TYPE } from '@/lib/web-projects';
import type { WorkspaceFile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AuthenticatedImage } from './authenticated-image';
import { extensionOf, getFileExtensionLabel, getFileKind, getFileTypeMeta } from './file-types';

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
  if (contentType === WEB_PROJECT_TYPE) return <FolderTile className={className} />;

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
        className="absolute inset-x-1.5 bottom-1.5 truncate rounded-sm bg-background/70 px-1 py-px text-center text-xs leading-tight font-semibold tracking-wide"
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

/* ── Thumbnails ──────────────────────────────────────────────────────────────
 * An image is the one kind whose glyph tells you nothing: a folder of
 * screenshots is a dozen identical tiles until you can see them. So an image
 * shows its own pixels wherever the layout has room, and every other kind keeps
 * the glyph.
 *
 * There is no resizing endpoint: download the original, then cache a small
 * raster for grid/list display. The byte guard and lazy loading limit network
 * work; serialized decoding and bounded dimensions limit browser pixel memory.
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
  fit = 'cover',
}: {
  file: ThumbnailSource;
  className?: string;
  /** Shown instead of the box when the image will never arrive. */
  fallback: ReactNode;
  /** Shown inside the box until it does. */
  placeholder: ReactNode;
  fit?: 'cover' | 'contain';
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
      <AuthenticatedImage
        fileId={file.id}
        deferUntilVisible
        thumbnail
        onUnavailable={() => setBroken(true)}
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
          'size-full transition-opacity duration-200',
          fit === 'contain' ? 'object-contain' : 'object-cover',
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

/** File visual. Gallery previews fit the whole image; compact tiles crop it. */
export function FileTile({ file, className, preview = false }: { file: WorkspaceFile; className?: string; preview?: boolean }) {
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
      fit={preview ? 'contain' : 'cover'}
      className={cn(
        preview ? 'h-full w-full rounded-lg' : 'size-19 rounded-xl border border-border/70 shadow-xs transition-transform',
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
