import { expect, it } from 'vitest';
import { humanMessageContent } from './message-content';
it('hides only the redundant attachment fallback and preserves captions and ordinary paths', () => {
  const files = [{ filename: 'uploaded_files/20261014_photo.png' }, { filename: 'uploaded_files/20261014_other.png' }];
  expect(humanMessageContent(files.map(f => f.filename).join(', '), files)).toBe('');
  expect(humanMessageContent('Please review this image', files)).toBe('Please review this image');
  expect(humanMessageContent(files[0].filename, [])).toBe(files[0].filename);
  expect(humanMessageContent('Save to uploaded_files/custom.png', files)).toBe('Save to uploaded_files/custom.png');
});
