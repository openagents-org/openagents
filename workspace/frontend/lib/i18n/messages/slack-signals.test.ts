import { describe, expect, it } from 'vitest';
import enUS from './en-US';
import zhCN from './zh-CN';

describe('slackSignals messages', () => {
  it('is the last block in both locales, with identical keys', () => {
    expect(Object.keys(enUS).at(-1)).toBe('slackSignals');
    expect(Object.keys(zhCN).at(-1)).toBe('slackSignals');
    expect(Object.keys(zhCN.slackSignals)).toEqual(Object.keys(enUS.slackSignals));
  });

  it('is really translated, and keeps the {count} placeholder', () => {
    for (const key of Object.keys(enUS.slackSignals) as (keyof typeof enUS.slackSignals)[]) {
      expect(zhCN.slackSignals[key]).not.toBe(enUS.slackSignals[key]);
      expect(zhCN.slackSignals[key].includes('{count}')).toBe(enUS.slackSignals[key].includes('{count}'));
    }
  });
});
