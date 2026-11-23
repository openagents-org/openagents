// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ currentUser: { id: 'alex@example.com', isAuthenticated: true } }) }));
vi.mock('@/hooks/use-team-roster', () => ({ useHumanNames: () => ({}), useTeamRoster: () => [] }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ formatTime: () => '' }) }));
vi.mock('./markdown-content', () => ({ MarkdownContent: ({ content }: { content: string }) => React.createElement('div', null, content) }));
vi.mock('./message-reactions', () => ({ MessageReactions: () => null }));
vi.mock('./message-audience', () => ({ MessageAudience: () => React.createElement('span', { 'data-audience': '' }) }));
import { ChatMessage } from './chat-message';
import { citationFor } from './reply-citation';
import { eventToMessage, type ONMEvent } from '@/lib/types';
import { guestDisplayName, isGuestAddress, isGuestMessage } from '@/lib/guest-sender';

const ADDRESS = 'guest-7f3a@guest.invalid';
function guestEvent(partial: Partial<ONMEvent> = {}): ONMEvent {
  return {
    id: 'evt-1',
    type: 'workspace.message.posted',
    source: `human:${ADDRESS}`,
    target: 'channel/share-abc',
    payload: { content: '@pr-reviewer review #42', sender_name: 'Maya', sender_email: ADDRESS },
    metadata: { sender_email: ADDRESS, guest: { id: '7f3a', name: 'Maya' } },
    timestamp: 1_700_000_000_000,
    visibility: 'channel',
    ...partial,
  } as ONMEvent;
}

describe('guest sender helpers', () => {
  it('recognises the guest domain with or without the human: prefix', () => {
    expect(isGuestAddress(`human:${ADDRESS}`)).toBe(true);
    expect(isGuestAddress('GUEST-1@Guest.Invalid')).toBe(true);
    expect(isGuestAddress('alex@example.com')).toBe(false);
    expect(isGuestAddress(null)).toBe(false);
  });

  it('names a guest from metadata, then the payload name, never the address', () => {
    expect(guestDisplayName({ metadata: { guest: { id: '1', name: 'Maya' } } }, 'Other')).toBe('Maya');
    expect(guestDisplayName({ metadata: {} }, 'Sam')).toBe('Sam');
    expect(guestDisplayName({ metadata: {}, senderName: ADDRESS }, ADDRESS)).toBe('Guest');
  });
});

describe('eventToMessage for a guest post', () => {
  it('keeps the guest name as the sender', () => {
    const m = eventToMessage(guestEvent());
    expect(m.senderType).toBe('human');
    expect(m.senderName).toBe('Maya');
    expect(isGuestMessage(m)).toBe(true);
  });

  it('never falls back to the raw address when sender_name is missing', () => {
    const fromMetadata = eventToMessage(guestEvent({ payload: { content: 'hi' } }));
    expect(fromMetadata.senderName).toBe('Maya');
    const bare = eventToMessage(guestEvent({ payload: { content: 'hi' }, metadata: {} }));
    expect(bare.senderName).toBe('Guest');
    expect(isGuestMessage(bare)).toBe(true);
  });

  it('leaves ordinary people alone', () => {
    const m = eventToMessage(guestEvent({ source: 'human:alex@example.com', payload: { content: 'hi' }, metadata: {} }));
    expect(m.senderName).toBe('alex@example.com');
    expect(isGuestMessage(m)).toBe(false);
  });
});

describe('a guest message in the owner’s thread', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('shows the guest name and a Guest badge, and no address or mention link', async () => {
    const mention = vi.fn();
    const message = eventToMessage(guestEvent());
    await act(async () => root.render(React.createElement(ChatMessage, { message, onMentionPerson: mention })));
    const text = host.textContent || '';
    expect(text).toContain('Maya');
    expect(host.querySelector('[data-guest-badge]')?.textContent).toBe('chat.guestBadge');
    expect(text).not.toContain('guest.invalid');
    expect(host.innerHTML).not.toContain('guest.invalid');
    // A guest has no mentionable address, so the name isn't a mention button.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Maya')).toBe(false);
  });

  it('marks a guest by metadata even from an unexpected address', async () => {
    const message = eventToMessage(guestEvent({ source: 'human:someone@example.com' }));
    await act(async () => root.render(React.createElement(ChatMessage, { message })));
    expect(host.querySelector('[data-guest-badge]')).not.toBeNull();
    expect(host.textContent).toContain('Maya');
  });

  it('shows no Guest badge for workspace members', async () => {
    const message = eventToMessage(guestEvent({ source: 'human:sam@example.com', payload: { content: 'hi', sender_name: 'Sam' }, metadata: {} }));
    await act(async () => root.render(React.createElement(ChatMessage, { message })));
    expect(host.querySelector('[data-guest-badge]')).toBeNull();
    expect(host.textContent).toContain('Sam');
    expect(host.querySelector('[data-audience]')).not.toBeNull();
  });

  it('renders a Share decision notice as a system line', async () => {
    const message = eventToMessage({ id: 'n1', type: 'workspace.message.posted', source: 'system:share', target: 'channel/share-abc',
      payload: { content: 'Alex approved Maya’s request.', message_type: 'notice', sender_name: 'OpenAgents' },
      metadata: { share_request_update: { id: 'r1', messageId: 'evt-1', status: 'approved' } }, timestamp: 1, visibility: 'channel' } as ONMEvent);
    await act(async () => root.render(React.createElement(ChatMessage, { message })));
    expect(host.querySelector('[data-share-notice="n1"]')?.textContent).toBe('Alex approved Maya’s request.');
    expect(host.querySelector('[data-guest-badge]')).toBeNull();
    expect(host.textContent).not.toContain('OpenAgents');
  });

  it('shows a held guest request’s status instead of the routing badge', async () => {
    const held = eventToMessage(guestEvent({ metadata: { sender_email: ADDRESS, guest: { id: '7f3a', name: 'Maya' }, share_request: { id: 'r1', status: 'pending' }, target_agents: ['__no_response__'] } }));
    await act(async () => root.render(React.createElement(ChatMessage, { message: held })));
    expect(host.querySelector('[data-share-request="pending"]')?.textContent).toBe('share.requestWaiting');
    expect(host.querySelector('[data-audience]')).toBeNull();
    await act(async () => root.render(React.createElement(ChatMessage, { message: held, shareRequestStatus: 'approved' })));
    expect(host.querySelector('[data-share-request]')?.getAttribute('data-share-request')).toBe('approved');
    expect(host.querySelector('[data-share-request]')?.textContent).toBe('guestThread.requestApproved');
  });

  it('cites a guest by name when replying', () => {
    expect(citationFor(eventToMessage(guestEvent())).sender_name).toBe('Maya');
  });
});
