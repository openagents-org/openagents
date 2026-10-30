// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IssueMentionInput } from './issue-mention-input';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('./issue-ui', () => ({ IssueAvatar: () => null }));
it('replaces selected text with Markdown and preserves existing mention identities', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let saved = '';
  function Editor() {
    const [value, setValue] = useState('@alice@example.com replace');
    saved = value;
    return createElement(IssueMentionInput, { value, onValueChange: setValue,
      mentions: [{ name: 'Alice', token: 'alice@example.com', source: 'human:alice@example.com', kind: 'human' }],
    });
  }
  try {
    await act(async () => root.render(createElement(Editor)));
    const textarea = host.querySelector('textarea')!;
    expect(textarea.value).toBe('@Alice replace');
    textarea.setSelectionRange(7, 14);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/html' ? '<strong>formatted</strong>' : '' } });
    await act(async () => { textarea.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('@Alice **formatted**');
    expect(saved).toBe('@alice@example.com **formatted**');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
