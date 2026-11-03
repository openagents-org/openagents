import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { ToolCall } from '../../types'

const CATEGORY_ICONS: Record<NonNullable<ToolCall['category']>, string> = {
  workspace: '🏢',
  files:     '📁',
  browser:   '🌐',
  tunnel:    '🔌',
  todos:     '✅',
  timers:    '⏱',
  terminal:  '⌨',
  other:     '🛠',
}

// One neutral card for every state; the dot beside the label says which.
// Only a failed call keeps colour in its border, so it can be found in a
// long run of calls.
const STATUS_STYLE: Record<ToolCall['status'], string> = {
  pending: 'border-border bg-card',
  success: 'border-border bg-card',
  error:   'border-(--danger-border) bg-card',
}

const STATUS_DOT: Record<ToolCall['status'], string> = {
  pending: 'bg-(--warning) animate-pulse',
  success: 'bg-(--success)',
  error:   'bg-(--danger)',
}

const STATUS_LABEL_KEY: Record<ToolCall['status'], string> = {
  pending: 'chat.toolCall.running',
  success: 'chat.toolCall.success',
  error:   'chat.toolCall.error',
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

export default function ToolCallCard({ call }: { call: ToolCall }): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const icon = CATEGORY_ICONS[call.category || 'other']
  const argsStr = formatJson(call.args)
  const resultStr = formatJson(call.result)

  return (
    <div className={cn('my-2 rounded-(--radius) border text-xs', STATUS_STYLE[call.status])}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{icon}</span>
          <span className="font-mono font-medium truncate">{call.name}</span>
          <span className="text-3xs text-(--text-tertiary) shrink-0">[{call.category || t('chat.toolCall.tool')}]</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {typeof call.durationMs === 'number' && (
            <span className="text-3xs text-(--text-tertiary)">{call.durationMs}ms</span>
          )}
          <span className={cn('inline-flex items-center gap-1.5 text-xs', call.status === 'error' ? 'text-(--danger-text)' : 'text-muted-foreground')}>
            <span className={cn('size-1.5 rounded-full', STATUS_DOT[call.status])} />
            {t(STATUS_LABEL_KEY[call.status])}
          </span>
          <span className="text-3xs text-(--text-tertiary)">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (argsStr || resultStr) && (
        <div className="px-3 pb-2 space-y-2 text-2xs">
          {argsStr && (
            <div>
              <div className="text-3xs uppercase tracking-wider text-(--text-tertiary) mb-1">{t('chat.toolCall.args')}</div>
              <pre className="font-mono whitespace-pre-wrap break-words bg-(--bg-input) rounded px-2 py-1.5 max-h-50 overflow-y-auto">{argsStr}</pre>
            </div>
          )}
          {resultStr && (
            <div>
              <div className="text-3xs uppercase tracking-wider text-(--text-tertiary) mb-1">{t('chat.toolCall.result')}</div>
              <pre className="font-mono whitespace-pre-wrap break-words bg-(--bg-input) rounded px-2 py-1.5 max-h-75 overflow-y-auto">{resultStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
