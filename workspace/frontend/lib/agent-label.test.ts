import { afterEach, describe, expect, it } from 'vitest';

import { agentLabel } from './helpers';
import { setActiveLocale } from './i18n/active-locale';

describe('agentLabel', () => {
  afterEach(() => setActiveLocale('en-US'));

  it('names the built-in assistant for what it does, in the active language', () => {
    setActiveLocale('zh-CN');
    expect(agentLabel({ agentName: 'yumi', builtin: true })).toBe('Yumi答疑小助手');
    setActiveLocale('en-US');
    expect(agentLabel({ agentName: 'yumi', builtin: true })).toBe('Yumi · Help Assistant');
  });

  it("leaves a user's own agent called yumi alone", () => {
    expect(agentLabel({ agentName: 'yumi' })).toBe('yumi');
    expect(agentLabel({ agentName: 'yumi', builtin: false })).toBe('yumi');
  });

  it('prefers a display name someone set', () => {
    expect(agentLabel({ agentName: 'yumi', builtin: true, displayName: 'Helper' })).toBe('Helper');
    expect(agentLabel({ agentName: 'coder', displayName: '  ' })).toBe('coder');
  });
});
