'use client';

import { isValidElement, type ReactNode } from 'react';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@/components/ui/code-block';
import { useHighlightedCode } from '@/hooks/use-highlighted-code';
import { useT } from '@/lib/i18n';
import { getPlainText } from './mermaid-utils';

/** The language of a fenced block, from the `language-*` class on its <code>. */
export function getFenceLanguage(children: ReactNode): string {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string }>(child)) return '';
  return /\blanguage-([\w+#-]+)/.exec(child.props.className ?? '')?.[1] ?? '';
}

/**
 * A fenced Markdown block as a shadcn Code Block: Shiki highlighting, the
 * language as its title and a copy button. Without a language the copy button
 * floats over the code instead.
 */
export function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const t = useT();
  const language = getFenceLanguage(children);
  const code = getPlainText(children).replace(/\n$/, '');
  const lines = useHighlightedCode(code, language || 'text');
  const copy = (
    <CodeBlockActions>
      <CodeBlockCopyButton value={code} copyLabel={t('chat.copyCode')} copiedLabel={t('chat.codeCopied')} />
    </CodeBlockActions>
  );

  return (
    <CodeBlock className="my-2" data-language={language || undefined}>
      {language ? (
        <CodeBlockHeader>
          <CodeBlockTitle className="font-mono">{language}</CodeBlockTitle>
          {copy}
        </CodeBlockHeader>
      ) : copy}
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}
