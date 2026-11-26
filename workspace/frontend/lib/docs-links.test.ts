import { describe, expect, it } from 'vitest';
import { docsUrl } from './docs-links';

describe('docsUrl', () => {
  it('opens the Chinese guide for a Chinese UI and the English one otherwise', () => {
    expect(docsUrl('zh-CN')).toBe('https://openagents.org/docs/zh/getting-started/overview');
    expect(docsUrl('en-US')).toBe('https://openagents.org/docs/en/getting-started/overview');
    // The guide has no other languages yet.
    expect(docsUrl('ja-JP')).toBe('https://openagents.org/docs/en/getting-started/overview');
  });
});
