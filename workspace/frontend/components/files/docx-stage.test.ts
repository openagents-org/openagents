// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { docxDocument } from './docx-stage';
import { convertToHtml } from 'mammoth';
import { readFileSync } from 'node:fs';

it('converts a Word document with headings and a table into a readable preview', async () => {
  const result = await convertToHtml({ buffer: readFileSync('components/files/fixtures/preview.docx') });
  const html = docxDocument(result.value);
  expect(html).toContain('Migration checklist');
  expect(html).toContain('<table>');
  expect(html).toContain('Review');
  expect(html).toContain('default-src');
});
it('strips document scripts, remote image sources, and navigable links', () => {
  const html = docxDocument('<script>alert(1)</script><p onclick="alert(1)">Safe</p><img src="https://tracker.test/a"><a href="javascript:alert(1)">Link</a><iframe src="https://tracker.test"></iframe>');
  expect(html).toContain('Safe'); expect(html).toContain('Link');
  expect(html).not.toContain('alert(1)'); expect(html).not.toContain('tracker.test');
  expect(html).not.toContain('<iframe');
});
