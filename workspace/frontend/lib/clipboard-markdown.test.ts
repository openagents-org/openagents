// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { clipboardMarkdown } from './clipboard-markdown';
const clipboard = (html: string, markdown = '') => ({ getData: (type: string) => type === 'text/html' ? html : type === 'text/markdown' ? markdown : '' });
it('preserves code blocks, bold, inline code and links from formatted text', () => {
  const result = clipboardMarkdown(clipboard('<p>Login checker runs:</p><pre><code class="language-arduino">security find-generic-password -s "Claude Code-credentials" -w\n</code></pre><p>The <strong><code>-w</code> retrieves the stored secret itself</strong>. <a href="https://attack.mitre.org/techniques/T1555/001/">MITRE documents this technique</a>.</p>'));
  expect(result).toContain('```arduino\nsecurity find-generic-password');
  expect(result).toContain('**`-w` retrieves the stored secret itself**');
  expect(result).toContain('[MITRE documents this technique](https://attack.mitre.org/techniques/T1555/001/)');
});
it('leaves plain-text Markdown to the native paste handler', () => {
  expect(clipboardMarkdown(clipboard(''))).toBeNull();
  expect(clipboardMarkdown(clipboard('<div>**bold** and `code`</div>'))).toBeNull();
});
it('prefers explicit Markdown over HTML', () => {
  expect(clipboardMarkdown(clipboard('<strong>bold</strong>', '**original**'))).toBe('**original**');
});
it('preserves lists and headings while dropping active content and copy buttons', () => {
  const result = clipboardMarkdown(clipboard('<h2>Steps</h2><ul><li>One</li><li><em>Two</em></li></ul><script>alert(1)</script><button>Copy code</button>'));
  expect(result).toContain('## Steps');
  expect(result).toMatch(/-\s+One/);
  expect(result).toContain('_Two_');
  expect(result).not.toMatch(/alert|Copy code/);
});
