// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { buildKnowledgeExport } from './knowledge-export';
it('exports a single title and preserves markdown content with safe filenames', () => {
  const result=buildKnowledgeExport({title:'Notes',description:null,content:'# Notes\n\n- One\n- Two'},'md');
  expect(result.content.match(/# Notes/g)).toHaveLength(1);
  expect(result.content).toContain('- Two');
  expect(buildKnowledgeExport({title:'folder/Notes',content:'test'},'txt').filename).toBe('folder-Notes.txt');
});
it('renders readable text and safe standalone HTML', () => {
  const entry={title:'Plan',content:'Hello **team**\n\n- First\n- Second\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))'};
  const text=buildKnowledgeExport(entry,'txt').content;
  expect(text).toContain('Hello team');
  expect(text).toMatch(/First\s+Second/);
  const html=buildKnowledgeExport(entry,'html').content;
  expect(html).toContain('<strong>team</strong>');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('Content-Security-Policy');
});
