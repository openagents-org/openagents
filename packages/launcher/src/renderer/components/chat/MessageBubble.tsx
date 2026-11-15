import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { ChatMessage } from '../../types'
import Markdown from './Markdown'
import ToolCallCard from './ToolCallCard'

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
  const initials = (message.senderName || '?').slice(0, 2).toUpperCase()
  const avatarColor = isHuman ? 'bg-[#888]' : isSystem ? 'bg-[#555]' : colorFor(message.senderName || '')

  return (
    <div className={cn('flex gap-3 mb-3', isHuman && 'flex-row-reverse')}>
      <div className={cn(
        'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white',
        avatarColor,
      )}>
        {initials}
      </div>
      <div className={cn('flex-1 min-w-0 max-w-[75%]', isHuman && 'items-end')}>
        <div className={cn('flex items-center gap-2 mb-1', isHuman && 'flex-row-reverse')}>
          <span className="text-xs font-semibold text-foreground">{message.senderName || t('chat.bubble.unknownSender')}</span>
          {message.metadata && (message.metadata as { agentType?: string }).agentType && (
            <span className="text-xs text-muted-foreground">
              {(message.metadata as { agentType?: string }).agentType}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{formatTime(message.createdAt)}</span>
          {isPending && <span className="text-xs text-muted-foreground">{t('chat.bubble.sending')}</span>}
        </div>
        <div className={cn(
          'rounded-lg px-3 py-2',
          isHuman
            ? 'bg-primary text-primary-foreground'
            : isSystem
              ? 'bg-muted text-muted-foreground italic'
              : 'bg-card border border-border text-foreground',
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
                  className="text-xs px-2 py-1 rounded bg-muted text-foreground border border-border hover:border-input flex items-center gap-1.5"
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
