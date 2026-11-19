import { describe, expect, it } from 'vitest';
import type { NodeCommand } from '@/lib/types';
import { pendingState } from './node-pending-agent';
import { recoverPending } from './pending-recovery';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function create(name: string, status: NodeCommand['status'], partial: Partial<NodeCommand> = {}): NodeCommand {
  return {
    commandId: `cmd-${name}-${status}`,
    action: 'create_agent',
    status,
    result: status === 'error' ? { ok: false, message: 'install failed' } : null,
    agentName: name,
    agentType: 'codex',
    draft: { name, type: 'codex', workingDir: '/work' },
    createdAt: ago(5),
    finishedAt: status === 'done' || status === 'error' ? ago(1) : null,
    ...partial,
  };
}

describe('recoverPending', () => {
  it('brings back adds in flight, just finished and recently failed', () => {
    const found = recoverPending([
      create('queued', 'pending'),
      create('installing', 'running'),
      create('joining', 'done'),
      create('broken', 'error'),
    ], [], new Set(), NOW);

    expect(found.map((p) => [p.name, p.cmdStatus])).toEqual([
      ['queued', 'pending'], ['installing', 'running'], ['joining', 'done'], ['broken', 'error'],
    ]);
    const broken = found.find((p) => p.name === 'broken')!;
    expect(broken.cmdMessage).toBe('install failed');
    // A failed add refills the form for a retry, without any key.
    expect(broken.draft).toEqual({ name: 'broken', type: 'codex', workingDir: '/work' });
  });

  it('skips agents the device reports, removed cards, old results and other actions', () => {
    const found = recoverPending([
      create('reported', 'running'),
      create('removed', 'error'),
      create('old-failure', 'error', { createdAt: ago(60 * 25) }),
      create('long-done', 'done', { finishedAt: ago(30) }),
      { ...create('started', 'running'), action: 'start_agent' },
    ], [{ name: 'reported', type: 'codex', status: 'running' }], new Set(['cmd-removed-error']), NOW);

    expect(found).toEqual([]);
  });

  it('only counts the newest add of a name', () => {
    const found = recoverPending([
      create('again', 'error', { commandId: 'older', createdAt: ago(20) }),
      create('again', 'running', { commandId: 'newer', createdAt: ago(2) }),
    ], [], new Set(), NOW);

    expect(found.map((p) => p.commandId)).toEqual(['newer']);
  });

  it('leaves out an agent removed after it was added, and an install that went quiet', () => {
    const found = recoverPending([
      create('gone', 'done', { createdAt: ago(8) }),
      { ...create('gone', 'done'), commandId: 'rm', action: 'remove_agent', createdAt: ago(3) },
      create('quiet', 'running', { createdAt: ago(90) }),
      create('offline-queue', 'pending', { createdAt: ago(60 * 48) }),
    ], [], new Set(), NOW);

    // A queued add on an offline device still runs when it reconnects.
    expect(found.map((p) => p.name)).toEqual(['offline-queue']);
  });
});

describe('pendingState', () => {
  const base = { name: 'a', type: 'codex', at: Date.now(), commandId: 'c1' };

  it('steps through waiting, installing and joining', () => {
    expect(pendingState(base)).toBe('waiting');
    expect(pendingState({ ...base, cmdStatus: 'pending' })).toBe('waiting');
    expect(pendingState({ ...base, cmdStatus: 'running' })).toBe('installing');
    expect(pendingState({ ...base, cmdStatus: 'done' })).toBe('starting');
    expect(pendingState({ ...base, cmdStatus: 'error' })).toBe('failed');
  });

  it('calls a finished install that never joined stalled', () => {
    expect(pendingState({ ...base, cmdStatus: 'done', at: Date.now() - 10 * 60_000 })).toBe('stalled');
  });
});
