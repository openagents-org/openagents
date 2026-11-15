/**
 * The add-agent gallery lists types by how many people use them: the top
 * twelve under "Popular", the rest under "Other agents", and the featured
 * spotlight in the same order. Types the order does not know go last, in
 * catalog order.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { messages as en } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { WorkspaceNode } from '@/lib/types';
import { AgentSetup, type AgentSetupApi } from './agent-setup';
import { MARKET_AGENT_ORDER, sortByUsage } from './agent-setup-market';

vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => translate(en, en, 'en-US', key, params),
}));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

const node = { nodeId: 'n1', name: 'LAPTOP-1', runtimes: [], agents: [] } as unknown as WorkspaceNode;

// Registry order, plus a type the usage order has never heard of.
const REGISTRY = [
  'claude', 'openclaw', 'codex', 'cursor', 'opencode', 'hermes', 'kimi', 'copilot', 'goose', 'aider',
  'amp', 'cline', 'gemini', 'antigravity', 'nanoclaw', 'mini-swe-agent', 'pi', 'deepseek',
  'commandcode', 'openworker', 'codebuddy', 'codearts', 'mimo-code', 'qoder', 'qoder-cn', 'qwen-code',
  'kiro', 'brand-new',
];
const catalog = REGISTRY.map((name) => ({
  name, label: `Label-${name}`, description: '', tags: [], featured: ['claude', 'codex', 'opencode', 'kimi'].includes(name),
})) as never;

describe('sortByUsage', () => {
  it('orders known types by usage and keeps unknown ones last, in input order', () => {
    const sorted = sortByUsage([{ name: 'zzz' }, { name: 'claude' }, { name: 'yyy' }, { name: 'codex' }]);
    expect(sorted.map((e) => e.name)).toEqual(['codex', 'claude', 'zzz', 'yyy']);
  });

  it('covers every type in the agent registry', () => {
    for (const name of REGISTRY.filter((n) => n !== 'brand-new')) expect(MARKET_AGENT_ORDER).toContain(name);
  });
});

describe('AgentSetup gallery order', () => {
  const html = renderToString(createElement(AgentSetup, {
    node, catalog, api: {} as AgentSetupApi, onBack: () => {}, onChanged: () => {},
  }));

  it('puts the twelve most used types under Popular, most used first', () => {
    const popular = ['codex', 'claude', 'opencode', 'hermes', 'cursor', 'deepseek', 'openclaw', 'gemini', 'codebuddy', 'antigravity', 'pi', 'kimi'];
    // Skip the featured spotlight, which comes first and repeats some labels.
    const grid = html.slice(html.indexOf(en.connect.marketPopular));
    const pos = (name: string) => grid.indexOf(`>Label-${name}<`);
    popular.forEach((name, i) => {
      if (i > 0) expect(pos(name)).toBeGreaterThan(pos(popular[i - 1]));
    });
    expect(pos('kimi')).toBeLessThan(grid.indexOf(en.connect.marketOthers));
    const rest = grid.slice(grid.indexOf(en.connect.marketOthers));
    expect(rest.indexOf('>Label-copilot<')).toBeLessThan(rest.indexOf('>Label-cline<'));
    expect(rest.indexOf('>Label-cline<')).toBeLessThan(rest.indexOf('>Label-aider<'));
    expect(rest.indexOf('>Label-mini-swe-agent<')).toBeLessThan(rest.indexOf('>Label-brand-new<'));
  });

  it('starts the featured spotlight with the most used featured type', () => {
    const spotlight = html.slice(0, html.indexOf(en.connect.marketPopular));
    expect(spotlight).toContain('>Label-codex<');
    expect(spotlight).not.toContain('>Label-claude<');
  });
});
