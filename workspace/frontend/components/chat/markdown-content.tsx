'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';
import { getAgentColor } from '@/lib/helpers';
import { memo, useMemo, type ReactNode } from 'react';

// Stable plugin arrays — avoids re-creating on every render
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

interface MarkdownContentProps {
  content: string;
  agentNames: string[];
}

/** Walk React children and colorize @agentname tokens in text nodes. */
function renderMentions(children: ReactNode, agentNames: string[]): ReactNode {
  if (!children || agentNames.length === 0) return children;

  const escaped = agentNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mentionRegex = new RegExp(`(@(?:${escaped.join('|')}))(?![\\w-])`, 'g');

  const processNode = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') {
      const parts = node.split(mentionRegex);
      if (parts.length === 1) return node;
      return parts.map((part, i) => {
        if (part.startsWith('@') && agentNames.includes(part.slice(1))) {
          const color = getAgentColor(part.slice(1), agentNames);
          return (
            <span key={i} className={cn('font-medium rounded px-0.5', color.text)}>
              {part}
            </span>
          );
        }
        return part;
      });
    }
    if (Array.isArray(node)) {
      return node.map((child, i) => <span key={i}>{processNode(child)}</span>);
    }
    return node;
  };

  if (Array.isArray(children)) {
    return children.map((child, i) => <span key={i}>{processNode(child)}</span>);
  }
  return processNode(children);
}

export const MarkdownContent = memo(function MarkdownContent({ content, agentNames }: MarkdownContentProps) {
  const components: Components = useMemo(() => ({
    // Block elements
    h1: ({ children }) => (
      <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-base font-bold mt-3 mb-1.5 first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="font-semibold text-[15px] mt-3 mb-1 first:mt-0">{children}</h3>
    ),
    p: ({ children }) => (
      <p className="leading-relaxed mb-2 last:mb-0">{renderMentions(children, agentNames)}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 my-2 text-muted-foreground italic">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-zinc-200 dark:border-zinc-700" />,

    // Lists
    ul: ({ children }) => (
      <ul className="my-2 ml-4 space-y-0.5 list-disc">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 ml-4 space-y-0.5 list-decimal">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed">{renderMentions(children, agentNames)}</li>
    ),

    // Tables
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-zinc-50 dark:bg-zinc-800/50">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-zinc-200 dark:border-zinc-700 last:border-0">
        {children}
      </tr>
    ),
    th: ({ children }) => (
      <th className="px-3 py-1.5 text-left font-semibold text-xs text-muted-foreground">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5">{renderMentions(children, agentNames)}</td>
    ),

    // Code
    code: ({ className, children, ...props }) => {
      const isBlock = className?.startsWith('language-') || className?.startsWith('hljs');
      if (isBlock) {
        return (
          <code className={cn('text-[13px]', className)} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className="text-[13px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-2 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 overflow-x-auto text-[13px] leading-relaxed font-mono">
        {children}
      </pre>
    ),

    // Links
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    ),

    // Inline
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [agentNames.join(',')]);

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
