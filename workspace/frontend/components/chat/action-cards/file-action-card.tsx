'use client';

import { FileText, Download } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileActionMetadata {
  actionType: 'file_shared';
  file: {
    id: string;
    filename: string;
    size?: number;
    url?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes?: number): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileActionCard({ metadata }: { metadata: FileActionMetadata }) {
  const { file } = metadata;
  const sizeStr = formatFileSize(file.size);

  return (
    <div className="rounded-lg border bg-muted/30 border-l-4 border-l-emerald-500 max-w-sm p-3 space-y-1.5">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="size-3.5" />
        <span>文件已分享</span>
      </div>

      {/* Filename + size */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-foreground leading-snug truncate">
          {file.filename}
        </p>
        {sizeStr && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {sizeStr}
          </span>
        )}
      </div>

      {/* Download button */}
      {file.url && (
        <a
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Download className="size-3" />
          下载
        </a>
      )}
    </div>
  );
}
