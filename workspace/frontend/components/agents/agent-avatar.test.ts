// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentAvatar, avatarIconFor } from './agent-avatar';
import { AgentTypesProvider, type AgentTypeEntry } from './agent-types';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const ROSTER: AgentTypeEntry[] = [
  { agentName: 'hermes-lc-1104-001', agentType: 'hermes' },
  { agentName: 'hermes-lc-codex-1104-001', agentType: 'hermes' },
  { agentName: 'researcher', agentType: 'cloud:openai' },
  { agentName: 'my-bot', agentType: 'langchain' },
  { agentName: 'untyped', agentType: null },
];

async function render(props: React.ComponentProps<typeof AgentAvatar>, roster: AgentTypeEntry[] | null = ROSTER) {
  const avatar = React.createElement(AgentAvatar, props);
  await act(async () => root.render(roster ? React.createElement(AgentTypesProvider, { agents: roster, children: avatar }) : avatar));
}
const iconSrc = () => container.querySelector('img')?.getAttribute('src') ?? null;
const isPattern = () => !container.querySelector('img') && !!container.querySelector('svg');

describe('AgentAvatar', () => {
  it('draws the type icon of an agent the workspace knows', async () => {
    await render({ name: 'hermes-lc-1104-001' });
    expect(iconSrc()).toBe('/icons/agents/hermes.svg');
  });

  it('gives agents of one type the same icon', async () => {
    await render({ name: 'hermes-lc-codex-1104-001' });
    expect(iconSrc()).toBe('/icons/agents/hermes.svg');
  });

  it('finds the agent by its address too', async () => {
    await render({ name: 'openagents:hermes-lc-1104-001' });
    expect(iconSrc()).toBe('/icons/agents/hermes.svg');
  });

  it('draws a cloud agent with its provider icon', async () => {
    await render({ name: 'researcher' });
    expect(iconSrc()).toBe('/icons/agents/openai.svg');
  });

  it.each([
    ['a type without an icon', 'my-bot'],
    ['no type', 'untyped'],
    ['an agent the workspace does not know', 'left-the-workspace'],
  ])('keeps the generated pattern for %s', async (_, name) => {
    await render({ name });
    expect(isPattern()).toBe(true);
  });

  it('keeps the generated pattern outside any agent list', async () => {
    await render({ name: 'hermes-lc-1104-001' }, null);
    expect(isPattern()).toBe(true);
  });

  it('takes a type passed in over the one looked up', async () => {
    await render({ name: 'hermes-lc-1104-001', type: 'claude' }, null);
    expect(iconSrc()).toBe('/icons/agents/claude.svg');
    await render({ name: 'hermes-lc-1104-001', type: null });
    expect(isPattern()).toBe(true);
  });

  it('keeps Yumi on its own avatar', async () => {
    await render({ name: 'yumi', type: 'claude' });
    expect(iconSrc()).toBe('/yumi-avatar.png');
  });

  it('keeps the status dot on an icon', async () => {
    await render({ name: 'hermes-lc-1104-001', showStatus: true, status: 'online' });
    expect(iconSrc()).toBe('/icons/agents/hermes.svg');
    expect(container.querySelector('.bg-green-500')).not.toBeNull();
  });
});

describe('avatarIconFor', () => {
  it.each([
    ['claude', 'claude'],
    ['Qwen-Code', 'qwen-code'],
    ['cloud:google', 'google'],
    ['cloud:tokenpay', null],
    ['custom', null],
    ['cloud:custom', null],
    ['default', null],
    ['', null],
    [null, null],
  ])('%s → %s', (type, icon) => {
    expect(avatarIconFor(type)).toBe(icon);
  });
});

it('merges a nested agent list into the outer one', async () => {
  const inner = React.createElement(AgentTypesProvider, {
    agents: [{ agentName: 'coder', agentType: 'codex' }],
    children: [
      React.createElement(AgentAvatar, { key: 'hermes', name: 'hermes-lc-1104-001' }),
      React.createElement(AgentAvatar, { key: 'coder', name: 'coder' }),
    ],
  });
  await act(async () => root.render(React.createElement(AgentTypesProvider, { agents: ROSTER, children: inner })));
  expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src')))
    .toEqual(['/icons/agents/hermes.svg', '/icons/agents/codex.svg']);
});
