'use strict';

// The daemon's credential-rotation watch: re-pairing a device rotates the
// workspace token on disk while running adapters keep the old one in memory
// (and 401 forever). _reconcileAdapterCredentials must restart exactly the
// adapters whose on-disk credential no longer matches the one they launched
// with — and nothing else.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Daemon } = require('../src/daemon');

function harness({ processes, adapters, resolved }) {
  const restarted = [];
  const self = {
    _shuttingDown: false,
    _processes: processes,
    _adapters: adapters,
    _log: () => {},
    _resolveAgentNetwork: (ref) => {
      const r = resolved[ref];
      if (r instanceof Error) throw r;
      return r || null;
    },
    restartAgent: async (name) => { restarted.push(name); },
  };
  const run = () => Daemon.prototype._reconcileAdapterCredentials.call(self);
  return { self, restarted, run };
}

describe('daemon credential-rotation watch', () => {
  it('restarts an adapter whose on-disk token rotated', () => {
    const info = { networkRef: 'ws', credentialToken: 'old-token' };
    const { restarted, run } = harness({
      processes: { claude: info },
      adapters: { claude: {} },
      resolved: { ws: { token: 'new-token' } },
    });
    run();
    assert.deepEqual(restarted, ['claude']);
    assert.equal(info._credRestartPending, true);
  });

  it('leaves an adapter alone when the token is unchanged', () => {
    const { restarted, run } = harness({
      processes: { claude: { networkRef: 'ws', credentialToken: 'tok' } },
      adapters: { claude: {} },
      resolved: { ws: { token: 'tok' } },
    });
    run();
    assert.deepEqual(restarted, []);
  });

  it('ignores local-only agents and agents without a live adapter', () => {
    const { restarted, run } = harness({
      processes: {
        local: { networkRef: null, credentialToken: null },
        gone: { networkRef: 'ws', credentialToken: 'old' },
      },
      adapters: {}, // neither has a running adapter
      resolved: { ws: { token: 'new' } },
    });
    run();
    assert.deepEqual(restarted, []);
  });

  it('does not stack restarts while one is already pending', () => {
    const info = { networkRef: 'ws', credentialToken: 'old' };
    const { restarted, run } = harness({
      processes: { claude: info },
      adapters: { claude: {} },
      resolved: { ws: { token: 'new' } },
    });
    run();
    run(); // second tick before the restart completes
    assert.deepEqual(restarted, ['claude']);
  });

  it('keeps running on the current token when resolution fails or is empty', () => {
    const { restarted, run } = harness({
      processes: {
        a: { networkRef: 'boom', credentialToken: 'tok' },
        b: { networkRef: 'tokenless', credentialToken: 'tok' },
        c: { networkRef: 'missing', credentialToken: 'tok' },
      },
      adapters: { a: {}, b: {}, c: {} },
      resolved: {
        boom: new Error('disk unreadable'),
        tokenless: { token: null },
        // 'missing' intentionally absent → resolves to null
      },
    });
    run();
    assert.deepEqual(restarted, []);
  });
});
