import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { ChatMessage } from '../../types'
import Markdown from './Markdown'
import ToolCallCard from './ToolCallCard'
import type { VariantProps } from 'class-variance-authority'
import { Badge, badgeVariants } from '../ui/badge'

// Terminal-reply kinds stamped by adapters (delegation receipts). The badge
// deliberately says "returned", never "task completed" — a finished turn is
// not proof the underlying task is done. Padding and type size ride on the
// Badge `size` prop, not on the variant.
const REPLY_KIND_VARIANT: Record<string, VariantProps<typeof badgeVariants>['variant']> = {
  result: 'success',
  error: 'danger',
  needs_input: 'warning',
  cancelled: 'muted',
}

const AGENT_COLORS = [
  'bg-[#6C63FF]', 'bg-[#FF6B6B]', 'bg-[#26A69A]', 'bg-[#FFA726]',
  'bg-[#42A5F5]', 'bg-[#AB47BC]', 'bg-[#66BB6A]', 'bg-[#EC407A]',
]

function colorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

export default function MessageBubble({
  message,
  isPending,
  onDownloadAttachment,
}: {
  message: ChatMessage
  isPending?: boolean
  onDownloadAttachment?: (fileId: string, filename: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isHuman = message.senderType === 'human'
  const isSystem = message.senderType === 'system'
  const replyKind = !isHuman && !isSystem
    ? (message.metadata as { reply_kind?: string } | undefined)?.reply_kind
    : undefined
  const replyKindVariant = replyKind ? REPLY_KIND_VARIANT[replyKind] : undefined
  const initials = (message.senderName || '?').slice(0, 2).toUpperCase()
  const avatarColor = isHuman ? 'bg-[#888]' : isSystem ? 'bg-[#555]' : colorFor(message.senderName || '')

  return (
    <div className={cn('flex gap-3 mb-3', isHuman && 'flex-row-reverse')}>
      <div className={cn(
        'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-3xs font-bold text-white',
        avatarColor,
      )}>
        {initials}
      </div>
      <div className={cn('flex-1 min-w-0 max-w-[75%]', isHuman && 'items-end')}>
        <div className={cn('flex items-center gap-2 mb-1', isHuman && 'flex-row-reverse')}>
          <span className="text-2xs font-semibold text-(--text-primary)">{message.senderName || t('chat.bubble.unknownSender')}</span>
          {message.metadata && (message.metadata as { agentType?: string }).agentType && (
            <span className="text-3xs text-(--text-tertiary)">
              {(message.metadata as { agentType?: string }).agentType}
            </span>
          )}
          {replyKindVariant && (
            <Badge variant={replyKindVariant} size="sm">{t(`chat.bubble.replyKind.${replyKind}`)}</Badge>
          )}
          <span className="text-3xs text-(--text-tertiary)">{formatTime(message.createdAt)}</span>
          {isPending && <span className="text-3xs text-(--warning-text)">{t('chat.bubble.sending')}</span>}
        </div>
        <div className={cn(
          'rounded-(--radius) px-3 py-2',
          isHuman
            ? 'bg-(--accent) text-(--accent-text)'
            : isSystem
              ? 'bg-(--bg-input) text-(--text-secondary) italic'
              : 'bg-(--bg-card) border border-(--border) text-(--text-primary)',
        )}>
          {message.content && (
            isHuman
              ? <div className="whitespace-pre-wrap text-sm">{message.content}</div>
              : <Markdown source={message.content} />
          )}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-1.5">
              {message.toolCalls.map((tc) => <ToolCallCard key={tc.id} call={tc} />)}
            </div>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {message.attachments.map((att, i) => (
                <button
                  type="button"
                  key={att.fileId || `${att.filename}-${i}`}
                  onClick={() => onDownloadAttachment && att.fileId && onDownloadAttachment(att.fileId, att.filename || 'file')}
                  className="text-2xs px-2 py-1 rounded bg-(--bg-input) text-(--text-primary) border border-(--border) hover:border-(--border-hover) flex items-center gap-1.5"
                >
                  <span>📎</span>
                  <span className="truncate max-w-45">{att.filename || att.fileId}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
