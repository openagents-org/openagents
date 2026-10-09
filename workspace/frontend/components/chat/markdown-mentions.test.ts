import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
vi.mock('./mermaid-block', () => ({ MermaidBlock: () => null }));
import { MarkdownContent } from './markdown-content';

function render(content: string) {
  return renderToStaticMarkup(
    createElement(MarkdownContent, {
      content,
      agentNames: ['research', 'research-agent'],
      agentLabels: { 'research-agent': 'Research agent' },
      humanNames: { 'alice@example.com': 'Alice', 'human:guest-1': 'Guest' },
    }),
  );
}
describe('mentions in Markdown', () => {
  it('renders persisted human and agent identities as display names', () => {
    const html = render('@alice@example.com please ask @research-agent.');
    expect(html).toContain('data-mention="alice@example.com"');
    expect(html).toContain('@Alice');
    expect(html).toContain('@Research agent');
  });
  it('avoids emails, longer names, code, and link destinations', () => {
    const html = render(
      'someone@research-agent.com @research-agent-extra `@research-agent` [link](https://example.com/@research-agent)',
    );
    expect(html).not.toContain('data-mention');
  });
  it('renders mentions in emphasis and list items', () => {
    const html = render('**@human:guest-1**\n\n- @research-agent');
    expect(html).toContain('@Guest');
    expect(html).toContain('@Research agent');
  });
});

describe('self mentions', () => {
  it('highlights mentions of the viewer more strongly', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: 'hey @alice@example.com and @bob@example.com',
        agentNames: [],
        humanNames: { 'alice@example.com': 'Alice', 'bob@example.com': 'Bob' },
        selfMention: 'alice@example.com',
      }),
    );
    expect(html).toContain('data-self-mention="true"');
    expect(html.match(/data-self-mention/g)?.length).toBe(1);
    expect(html).toContain('@Alice');
    expect(html).toContain('@Bob');
  });
});
