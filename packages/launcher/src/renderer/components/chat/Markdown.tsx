import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { copyTextToClipboard } from '../../lib/clipboard'

// Lightweight Markdown renderer — supports the subset called out in stage3.md:
// headings, paragraphs, bold/italic, inline code, fenced code blocks with copy,
// links, blockquotes, ordered/unordered/task lists, and tables.
//
// We render incrementally so partial markdown (mid-stream) still looks
// sensible — unclosed fences fall back to inline rendering.

interface Block {
  type: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'code' | 'ul' | 'ol' | 'blockquote' | 'table' | 'hr' | 'empty'
  text?: string
  lang?: string
  items?: string[]
  rows?: string[][]
  headerRow?: string[]
  level?: number
}

function parseMarkdown(src: string): Block[] {
  const lines = src.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    // Fenced code
    const fence = line.match(/^```(\w*)/)
    if (fence) {
      const lang = fence[1] || ''
      i++
      const buf: string[] = []
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // closing fence
      blocks.push({ type: 'code', lang, text: buf.join('\n') })
      continue
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.*)/)
    if (heading) {
      const level = heading[1].length
      blocks.push({ type: `h${level}` as Block['type'], text: heading[2] })
      i++
      continue
    }

    // Horizontal rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'blockquote', text: buf.join('\n') })
      continue
    }

    // Table (very simple — needs header + separator + body)
    if (line.includes('|') && lines[i + 1] && /^[\s|:-]+$/.test(lines[i + 1])) {
      const headerCells = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', headerRow: headerCells, rows })
      continue
    }

    // Lists
    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && (
        (/^[-*+]\s+/.test(lines[i]) && !ordered) ||
        (/^\d+\.\s+/.test(lines[i]) && ordered) ||
        (lines[i].startsWith('  ') && items.length > 0)
      )) {
        const m = lines[i].match(/^(?:[-*+]|\d+\.)\s+(.*)/)
        if (m) items.push(m[1])
        else if (items.length > 0) items[items.length - 1] += '\n' + lines[i].trim()
        i++
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items })
      continue
    }

    // Paragraph
    const buf: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|[-*+]\s|\d+\.\s)/.test(lines[i])) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', text: buf.join('\n') })
  }
  return blocks
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

function renderInline(text: string): React.ReactNode[] {
  // Order matters: code first so its content isn't reinterpreted.
  const nodes: React.ReactNode[] = []
  let remaining = text
  let keyIdx = 0
  const pushText = (t: string): void => {
    // Inline emphasis: **bold**, *italic*, ~~strike~~, [link](url)
    const out: React.ReactNode[] = []
    let rest = t
    const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(~~([^~]+)~~)/
    while (rest) {
      const m = rest.match(re)
      if (!m) { out.push(rest); break }
      if (m.index! > 0) out.push(rest.slice(0, m.index))
      if (m[1]) out.push(<a key={`a-${keyIdx++}`} href={m[3]} target="_blank" rel="noreferrer" className="text-(--accent) underline">{m[2]}</a>)
      else if (m[4]) out.push(<strong key={`b-${keyIdx++}`}>{m[5]}</strong>)
      else if (m[6]) out.push(<em key={`i-${keyIdx++}`}>{m[7]}</em>)
      else if (m[8]) out.push(<s key={`s-${keyIdx++}`}>{m[9]}</s>)
      rest = rest.slice((m.index || 0) + m[0].length)
    }
    nodes.push(...out)
  }

  const codeRe = /`([^`]+)`/g
  let last = 0
  let m
  while ((m = codeRe.exec(remaining)) !== null) {
    if (m.index > last) pushText(remaining.slice(last, m.index))
    nodes.push(
      <code key={`c-${keyIdx++}`} className="px-1 py-0.5 rounded bg-(--bg-input) text-xs font-mono">
        {m[1]}
      </code>,
    )
    last = m.index + m[0].length
  }
  if (last < remaining.length) pushText(remaining.slice(last))
  return nodes
}

function CodeBlock({ code, lang }: { code: string; lang?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await copyTextToClipboard(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <div className="relative my-2 rounded-(--radius) overflow-hidden border border-(--border) bg-[#1e1e2a]">
      <div className="flex items-center justify-between px-3 py-1 bg-[#26263a] text-3xs text-[#aaa] font-mono">
        <span>{lang || t('chat.markdown.text')}</span>
        <button
          type="button"
          onClick={copy}
          className="px-2 py-0.5 rounded text-3xs bg-[#3a3a55] text-white hover:bg-[#4a4a6a] transition-colors"
        >
          {copied ? t('chat.markdown.copied') : t('chat.markdown.copy')}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-[1.55] text-[#e6e6ea]">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  )
}

interface MarkdownProps {
  source: string
  className?: string
}

export default function Markdown({ source, className }: MarkdownProps): React.JSX.Element {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className={cn('text-sm leading-[1.6] text-(--text-primary) break-words', className)}>
      {blocks.map((b, idx) => {
        switch (b.type) {
          case 'h1': return <h1 key={idx} className="text-xl font-bold mt-3 mb-2">{renderInline(b.text || '')}</h1>
          case 'h2': return <h2 key={idx} className="text-lg font-bold mt-3 mb-2">{renderInline(b.text || '')}</h2>
          case 'h3': return <h3 key={idx} className="text-base font-bold mt-2.5 mb-1.5">{renderInline(b.text || '')}</h3>
          case 'h4': return <h4 key={idx} className="text-sm font-bold mt-2 mb-1">{renderInline(b.text || '')}</h4>
          case 'p':  return <p key={idx} className="my-1 whitespace-pre-wrap">{renderInline(b.text || '')}</p>
          case 'hr': return <hr key={idx} className="my-3 border-t border-(--border)" />
          case 'code': return <CodeBlock key={idx} code={b.text || ''} lang={b.lang} />
          case 'blockquote': return (
            <blockquote key={idx} className="my-2 pl-3 border-l-2 border-(--accent) text-(--text-secondary) italic">
              {renderInline(b.text || '')}
            </blockquote>
          )
          case 'ul': return (
            <ul key={idx} className="list-disc pl-5 my-1.5 space-y-0.5">
              {(b.items || []).map((it, j) => {
                const task = it.match(/^\[( |x|X)\]\s+(.*)/)
                if (task) {
                  return (
                    <li key={j} className="list-none -ml-5 flex items-start gap-2">
                      <input type="checkbox" checked={task[1].toLowerCase() === 'x'} readOnly className="mt-1" />
                      <span>{renderInline(task[2])}</span>
                    </li>
                  )
                }
                return <li key={j}>{renderInline(it)}</li>
              })}
            </ul>
          )
          case 'ol': return (
            <ol key={idx} className="list-decimal pl-5 my-1.5 space-y-0.5">
              {(b.items || []).map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ol>
          )
          case 'table': return (
            <div key={idx} className="my-2 overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>{(b.headerRow || []).map((h, j) => (
                    <th key={j} className="px-2 py-1 border border-(--border) bg-(--bg-input) text-left font-semibold">{renderInline(h)}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {(b.rows || []).map((r, j) => (
                    <tr key={j}>{r.map((c, k) => (
                      <td key={k} className="px-2 py-1 border border-(--border)">{renderInline(c)}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          default: return null
        }
      })}
    </div>
  )
}
