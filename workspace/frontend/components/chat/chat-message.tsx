'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Copy, Check, User, FileIcon, Download, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { memo, useCallback, useMemo, useState } from 'react';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { MarkdownContent } from './markdown-content';
import { workspaceApi } from '@/lib/api';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useFormatters, useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';

interface Attachment {
  fileId: string;
  filename: string;
  contentType: string;
  url: string;
}

function humanColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 55% 82%)`;
}

function isPreviewable(contentType: string, filename: string): boolean {
  if (contentType?.startsWith('image/')) return true;
  if (contentType === 'text/html' || /\.html?$/i.test(filename)) return true;
  if (contentType === 'text/markdown' || /\.mdx?$/i.test(filename)) return true;
  if (contentType?.startsWith('text/') || /\.(json|js|ts|tsx|jsx|py|rs|go|java|rb|sh|yaml|yml)$/i.test(filename)) return true;
  return false;
}

function Attachments({ items }: { items: Attachment[] }) {
  if (!items || items.length === 0) return null;

  const { setViewMode } = useLayout();
  const { setSelectedFileId } = useWorkspace();

  const openPreview = useCallback((fileId: string) => {
    setSelectedFileId(fileId);
    setViewMode('files');
  }, [setSelectedFileId, setViewMode]);

  // Regenerate URLs from fileId to ensure they include current auth token
  const fixedItems = useMemo(() =>
    items.map((a) => ({ ...a, url: workspaceApi.getFileUrl(a.fileId) })),
    [items]
  );

  const images = fixedItems.filter((a) => a.contentType?.startsWith('image/'));
  const files = fixedItems.filter((a) => !a.contentType?.startsWith('image/'));

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <button
              key={img.fileId}
              type="button"
              onClick={() => openPreview(img.fileId)}
              className="block rounded-lg overflow-hidden border hover:shadow-md transition-shadow max-w-sm cursor-pointer text-left"
            >
              <img
                src={img.url}
                alt={img.filename}
                className="max-h-64 w-auto object-contain"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file) => {
            const previewable = isPreviewable(file.contentType, file.filename);
            return previewable ? (
              <button
                key={file.fileId}
                type="button"
                onClick={() => openPreview(file.fileId)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted hover:bg-muted/80 transition-colors text-sm cursor-pointer"
              >
                <Eye className="size-4 text-muted-foreground shrink-0" />
                <span className="truncate max-w-[200px]">{file.filename}</span>
              </button>
            ) : (
              <a
                key={file.fileId}
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted hover:bg-muted/80 transition-colors text-sm"
              >
                <FileIcon className="size-4 text-muted-foreground shrink-0" />
                <span className="truncate max-w-[200px]">{file.filename}</span>
                <Download className="size-3 text-muted-foreground shrink-0" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ChatMessageProps {
  message: WorkspaceMessage;
  agents?: WorkspaceAgent[];
}

export const ChatMessage = memo(function ChatMessage({ message, agents = [] }: ChatMessageProps) {
  const { currentUser } = useWorkspace();
  const t = useT();
  const { formatTime } = useFormatters();
  const isHuman = message.senderType === 'human' || message.senderType === 'user';
  const isSystem = message.messageType === 'status';
  const [copied, setCopied] = useState(false);

  const agentNames = useMemo(() => agents.map((a) => a.agentName), [agents]);
  const agentLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const a of agents) {
      if (a.displayName) labels[a.agentName] = agentLabel(a);
    }
    return labels;
  }, [agents]);
  const agent = agents.find((a) => a.agentName === message.senderName);
  const rawAttachments = (message.metadata?.attachments as Record<string, unknown>[]) || [];
  const attachments: Attachment[] = rawAttachments.map((a) => ({
    fileId: (a.fileId || a.file_id || '') as string,
    filename: (a.filename || '') as string,
    contentType: (a.contentType || a.content_type || '') as string,
    url: '',
  }));

  const timestamp = message.createdAt ? formatTime(message.createdAt) : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('chat.copyFailed'));
    }
  };

  // Status messages — subtle inline
  if (isSystem) {
    const isQueued = message.content.includes('queued');
    return (
      <div className="flex justify-center py-1">
        <span className={cn(
          'text-xs italic',
          isQueued
            ? 'text-foreground/80'
            : 'text-muted-foreground'
        )}>
          {agent ? agentLabel(agent) : message.senderName}: {message.content}
        </span>
      </div>
    );
  }

  // ── Human message ──
  // Everyone reads the same way: avatar + name + time on the left, like the
  // agent turns below. A shared workspace has several people in it, so your own
  // turns stay in the same column as theirs rather than becoming right-aligned
  // bubbles — the thread reads as one transcript.
  if (isHuman) {
    const isCurrentUser = !!message.senderId && message.senderId === currentUser.id;
    const seed = message.senderId || message.senderName || 'human';
    const displayName = isCurrentUser
      ? 'You'
      : (message.senderName && message.senderName !== 'user' ? message.senderName : 'User');

    return (
      <div className="py-2">
        <div className="flex items-start gap-3">
          <div
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: humanColor(seed) }}
          >
            <User className="size-3.5 text-zinc-700" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-foreground">{displayName}</span>
              {timestamp && (
                <span className="text-[11px] text-muted-foreground">{timestamp}</span>
              )}
            </div>
            <div className="mt-0.5 text-sm leading-relaxed">
              <MarkdownContent content={message.content} agentNames={agentNames} agentLabels={agentLabels} />
              <Attachments items={attachments} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Agent message ──
  // Full-bleed, no bubble — ChatGPT's assistant turn. The avatar and name stay:
  // a thread can have several agents, so the author still has to be readable.
  return (
    <div className="group py-2">
      <div className="flex items-start gap-3">
        <AgentAvatar name={message.senderName} size={28} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {agent ? agentLabel(agent) : message.senderName}
            </span>
            {agent && (
              <span className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                agent.role === 'master'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              )}>
                {agent.role}
              </span>
            )}
            {timestamp && (
              <span className="text-[11px] text-muted-foreground">{timestamp}</span>
            )}
          </div>
          <div className="mt-0.5 text-sm leading-relaxed">
            <MarkdownContent content={message.content} agentNames={agentNames} agentLabels={agentLabels} />
            <Attachments items={attachments} />

            {/* Action bar — revealed on hover, as in ChatGPT */}
            <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
                aria-label={t('chat.copyMessage')}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
