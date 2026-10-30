import TurndownService from 'turndown';

/** Return Markdown for rich clipboard content, or null for native plain-text paste. */
export function clipboardMarkdown(clipboard: Pick<DataTransfer, 'getData'>): string | null {
  const markdown = clipboard.getData('text/markdown');
  if (markdown) return markdown;
  const html = clipboard.getData('text/html');
  if (!html) return null;
  try {
    // Parse in an inert document; never mount clipboard HTML in the page.
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('script, style, iframe, object, button, input, select, textarea').forEach(node => node.remove());
    // Plain text copied from editors is often wrapped in a div or span. Keep it
    // verbatim rather than escaping Markdown syntax that the user already wrote.
    if (!document.body.querySelector('strong, b, em, i, s, del, a, pre, code, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, hr, img')) return null;
    const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    converter.addRule('strikethrough', {
      filter: ['s', 'del'],
      replacement: content => `~~${content}~~`,
    });
    const result = converter.turndown(document.body);
    return result.trim() ? result : null;
  } catch {
    return null; // Clipboard formats vary; ordinary paste must still work.
  }
}
