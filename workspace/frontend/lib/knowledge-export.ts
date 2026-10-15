import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { stripLeadingTitle } from '@/components/knowledge/knowledge-utils';

export function buildKnowledgeExport(entry: { title: string; description?: string | null; content: string }, format: 'md' | 'txt' | 'html') {
  const filename = (entry.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().replace(/[. ]+$/g, '').slice(0, 120) || 'knowledge') + '.' + format;
  const markdown = `# ${entry.title}\n\n${entry.description ? entry.description + '\n\n' : ''}${stripLeadingTitle(entry.content, entry.title)}\n`;
  if (format === 'md') return { content: markdown, filename, mime: 'text/markdown;charset=utf-8' };
  // ReactMarkdown escapes raw HTML and rejects unsafe link protocols.
  const body = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], children: markdown }));
  if (format === 'txt') {
    const doc = new DOMParser().parseFromString(body, 'text/html');
    doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,pre,tr,blockquote').forEach(node => node.append('\n'));
    doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    doc.querySelectorAll('td,th').forEach(node => node.append('\t'));
    return { content: (doc.body.textContent || '').trim() + '\n', filename, mime: 'text/plain;charset=utf-8' };
  }
  const title = entry.title.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return { filename, mime: 'text/html;charset=utf-8', content: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';"><title>${title}</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#18181b;max-width:800px;margin:48px auto;padding:0 24px}h1,h2,h3{line-height:1.25}pre,code{background:#f4f4f5;border-radius:4px}pre{padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}code{font-size:.9em}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}a{color:#2563eb}blockquote{border-left:3px solid #ddd;padding-left:16px;color:#52525b}@media print{body{margin:0;max-width:none}pre,table,img{break-inside:avoid}a{color:inherit}}</style></head><body><article>${body}</article></body></html>` };
}
