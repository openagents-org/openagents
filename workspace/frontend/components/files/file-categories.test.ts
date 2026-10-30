import { expect, it } from 'vitest';
import { getFileFilterGroup } from './file-utils';
import { WEB_PROJECT_TYPE } from '@/lib/web-projects';
it('separates PDFs, images, documents and complete web projects', () => {
  expect(getFileFilterGroup('application/octet-stream','notes.md')).toBe('documents');
  expect(getFileFilterGroup('application/pdf','notes.pdf')).toBe('pdf');
  expect(getFileFilterGroup('image/png','image.png')).toBe('images');
  expect(getFileFilterGroup(WEB_PROJECT_TYPE,'dashboard.zip')).toBe('web');
});
