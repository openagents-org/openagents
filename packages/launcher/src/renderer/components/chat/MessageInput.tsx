import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { Button } from '../shadcn/button'
import type { Attachment, WorkspaceParticipant } from '../../types'

interface MessageInputProps {
  participants: WorkspaceParticipant[]
  disabled?: boolean
  onSend: (content: string, attachments: Attachment[]) => Promise<void>
  onUpload: (file: File) => Promise<Attachment | null>
}

// Icons inlined as small SVG components to avoid pulling extra deps.
// Visual language matches the rest of the launcher (mono-stroke, currentColor).

function PaperclipIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 0 1 5.66 5.66l-8.58 8.57a2 2 0 0 1-2.83-2.83l7.93-7.93" />
    </svg>
  )
}

function ArrowUpIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default function MessageInput({
  participants,
  disabled,
  onSend,
  onUpload,
}: MessageInputProps): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [uploadingCount, setUploadingCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [mentionState, setMentionState] = useState<{ open: boolean; query: string; pos: number } | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-grow the textarea up to ~6 lines.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  const canSend = !disabled && !sending && (value.trim().length > 0 || attachments.length > 0)

  const handleSend = async (): Promise<void> => {
    if (!canSend) return
    setSending(true)
    try {
      await onSend(value.trim(), attachments)
      setValue('')
      setAttachments([])
      setMentionState(null)
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mentionState?.open && e.key === 'Escape') {
      e.preventDefault()
      setMentionState(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const text = e.target.value
    setValue(text)
    const caret = e.target.selectionStart || text.length
    const upTo = text.slice(0, caret)
    const match = upTo.match(/(^|\s)@([a-zA-Z0-9_-]*)$/)
    if (match) {
      setMentionState({ open: true, query: match[2], pos: caret - match[2].length - 1 })
    } else {
      setMentionState(null)
    }
  }

  const insertMention = (name: string): void => {
    if (!mentionState) return
    const before = value.slice(0, mentionState.pos)
    const after = value.slice(textRef.current?.selectionStart || value.length)
    const next = `${before}@${name} ${after}`
    setValue(next)
    setMentionState(null)
    requestAnimationFrame(() => {
      textRef.current?.focus()
      const caret = (before + '@' + name + ' ').length
      textRef.current?.setSelectionRange(caret, caret)
    })
  }

  const filteredParticipants = mentionState
    ? participants.filter((p) => p.agentName.toLowerCase().startsWith(mentionState.query.toLowerCase())).slice(0, 6)
    : []

  const handleFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploadingCount((c) => c + list.length)
    try {
      for (const f of list) {
        const att = await onUpload(f)
        if (att) setAttachments((prev) => [...prev, att])
      }
    } finally {
      setUploadingCount((c) => Math.max(0, c - list.length))
    }
  }

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const files: File[] = []
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      await handleFiles(files)
    }
  }

  const removeAttachment = (idx: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 bg-(--bg-primary)">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length > 0) await handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          'relative rounded-2xl border border-(--border) bg-(--bg-card) shadow-(--shadow-sm)',
          'transition-all focus-within:border-(--accent) focus-within:shadow-(--shadow-md)',
          dragOver && 'border-(--accent) bg-[rgba(108,99,255,0.04)]',
          disabled && 'opacity-60',
        )}
      >
        {dragOver && (
          <div className="absolute inset-1 pointer-events-none flex items-center justify-center rounded-xl border-2 border-dashed border-(--accent) bg-(--bg-card)/95 text-(--accent) text-xs font-semibold z-10">
            {t('chat.input.dropToAttach')}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
            {attachments.map((att, i) => (
              <div
                key={att.fileId || i}
                className="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-(--bg-input) border border-(--border) text-2xs"
              >
                <PaperclipIcon className="w-3 h-3 text-(--text-tertiary)" />
                <span className="truncate max-w-40 text-(--text-primary)">{att.filename}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAttachment(i)}
                  title={t('chat.input.remove')}
                  className="ml-0.5 h-4 w-4 rounded-full text-(--text-tertiary) hover:enabled:text-(--danger-text)"
                >
                  <CloseIcon className="w-2.5 h-2.5" />
                </Button>
              </div>
            ))}
            {uploadingCount > 0 && (
              <span className="text-2xs text-(--text-tertiary) self-center px-1">
                {t('chat.input.uploading', { count: uploadingCount })}
              </span>
            )}
          </div>
        )}

        <div className="flex items-end gap-1 px-2 py-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || sending}
            title={t('chat.input.attachFile')}
            className="shrink-0 h-9 w-9 rounded-full text-(--text-tertiary) hover:enabled:text-(--text-primary)"
          >
            <PaperclipIcon className="w-4.5 h-4.5" />
          </Button>

          <textarea
            ref={textRef}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={disabled ? t('chat.input.placeholderDisabled') : t('chat.input.placeholder')}
            disabled={disabled || sending}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent border-0 outline-none',
              'px-1 py-2 text-sm leading-[1.5] text-(--text-primary) placeholder:text-(--text-tertiary)',
              'min-h-9 max-h-40',
            )}
          />

          <Button
            variant="default"
            size="icon"
            onClick={() => void handleSend()}
            disabled={!canSend}
            title={t('chat.input.send')}
            className="shrink-0 h-9 w-9 rounded-full"
          >
            <ArrowUpIcon className="w-4 h-4" />
          </Button>
        </div>

        {mentionState?.open && filteredParticipants.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 z-20 w-65 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-(--shadow-md) overflow-hidden">
            <div className="px-3 py-1.5 text-3xs uppercase tracking-wider text-(--text-tertiary) bg-(--bg-input)">
              {t('chat.input.mentionAgent')}
            </div>
            {filteredParticipants.map((p) => (
              <button
                key={p.agentName}
                type="button"
                onClick={() => insertMention(p.agentName)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-(--bg-input) flex items-center gap-2 cursor-pointer"
              >
                <span className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full',
                  p.status === 'online' ? 'bg-(--success)' : 'bg-(--text-tertiary)',
                )} />
                <span className="font-mono">@{p.agentName}</span>
                <span className="ml-auto text-3xs text-(--text-tertiary)">{p.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 text-center text-2xs text-(--text-tertiary)">
        <code className="font-mono text-(--text-secondary)">{t('chat.input.hintMention')}</code> {t('chat.input.hintDirect')} <kbd className="px-1 py-0.5 rounded bg-(--bg-input) text-3xs">{t('chat.input.hintEnterKey')}</kbd> {t('chat.input.hintToSend')}
      </div>
    </div>
  )
}
