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
  { agentName: 'claude-dev', agentType: 'claude' },
  { agentName: 'codex-main', agentType: 'codex' },
  { agentName: 'my-bot', agentType: 'langchain' },
  { agentName: 'untyped', agentType: null },
];

async function render(props: React.ComponentProps<typeof AgentAvatar>, roster: AgentTypeEntry[] | null = ROSTER) {
  const avatar = React.createElement(AgentAvatar, props);
  await act(async () => root.render(roster ? React.createElement(AgentTypesProvider, { agents: roster, children: avatar }) : avatar));
}
/** The file an avatar's icon comes from: an <img>, or a mask in the text colour. */
function iconSrc(el: ParentNode = container): string | null {
  const img = el.querySelector('img');
  if (img) return img.getAttribute('src');
  const mask = el.querySelector<HTMLElement>('[role="img"]')?.style.maskImage;
  return mask ? mask.replace(/^url\("?|"?\)$/g, '') : null;
}
const isPattern = () => !container.querySelector('img') && !!container.querySelector('svg');

describe('AgentAvatar', () => {
  it('draws the type icon of an agent the workspace knows', async () => {
    await render({ name: 'hermes-lc-1104-001' });
    expect(iconSrc()).toBe('/icons/agents/marks/hermes.svg');
  });

  it('gives agents of one type the same icon', async () => {
    await render({ name: 'hermes-lc-codex-1104-001' });
    expect(iconSrc()).toBe('/icons/agents/marks/hermes.svg');
  });

  it('finds the agent by its address too', async () => {
    await render({ name: 'openagents:hermes-lc-1104-001' });
    expect(iconSrc()).toBe('/icons/agents/marks/hermes.svg');
  });

  it('draws a cloud agent with its provider icon', async () => {
    await render({ name: 'researcher' });
    expect(iconSrc()).toBe('/icons/agents/marks/openai.svg');
  });

  it('draws icons with no frame and no white behind them', async () => {
    const icon = () => container.querySelector('span')!;
    // A vendor tile in a colour keeps its colour, without the hairline.
    await render({ name: 'claude-dev' });
    expect(iconSrc()).toBe('/icons/agents/claude.svg');
    expect(icon().className).not.toContain('ring-1');
    // A mark with no tile of its own gets no chip behind it.
    await render({ name: 'codex-main' });
    expect(iconSrc()).toBe('/icons/agents/codex.svg');
    expect(icon().className).not.toMatch(/ring-1|bg-background/);
  });

  it('fills a stacked avatar with the page colour so the one before does not show through', async () => {
    await render({ name: 'codex-main', stacked: true });
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-background');
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
    expect(iconSrc()).toBe('/icons/agents/marks/hermes.svg');
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
  expect([...container.children].map((avatar) => iconSrc(avatar)))
    .toEqual(['/icons/agents/marks/hermes.svg', '/icons/agents/codex.svg']);
});
