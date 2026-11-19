'use client';

import { Upload } from 'lucide-react';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * A .md/.zip package picker drawn like an Input. The native file input is
 * visually hidden because its "Choose File / No file chosen" text follows the
 * browser's language, not the workspace's; the label shows our own prompt and,
 * once picked, the file name and size.
 */
export function SkillFileField({
  id,
  file,
  onChange,
  invalid,
}: {
  id: string;
  file: File | null;
  onChange: (file: File | null) => void;
  invalid?: boolean;
}) {
  const t = useT();
  const { formatFileSize } = useFormatters();
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-input px-2.5 text-sm transition-colors hover:bg-muted/50 has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:bg-input/30',
        invalid && 'border-destructive ring-3 ring-destructive/20',
      )}
    >
      <Upload className="size-4 shrink-0 text-muted-foreground" />
      <span className={cn('min-w-0 flex-1 truncate', !file && 'text-muted-foreground')}>
        {file ? file.name : t('skills.uploadChooseFile')}
      </span>
      {file && <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>}
      <input
        id={id}
        type="file"
        accept=".md,.zip"
        className="sr-only"
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
    </label>
  );
}
