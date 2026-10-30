'use strict';

/**
 * Remote "create agent" installs through the daemon and this core installer,
 * which asked npm for `latest` whatever the Node that would run it. openclaw
 * 2026.10.6+ wants Node 24.22.1 and its preinstall exits 1 below that, so every
 * such install on the 24.21.0 portable runtime failed. The installer now holds
 * an unpinned package back to the newest release that runs, like the
 * launcher's Install button already did.
 *
 * Run: node --test test/node-engines.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { nodeSatisfies, resolveInstallableVersion, unpinnedPackage } = require('../src/node-engines');
const { Installer } = require('../src/installer');

describe('nodeSatisfies', () => {
  it('reads the ranges packages actually write', () => {
    assert.equal(nodeSatisfies('v24.21.0', '>=24.22.1 <25 || >=26.12.1'), false);
    assert.equal(nodeSatisfies('v24.22.1', '>=24.22.1 <25 || >=26.12.1'), true);
    assert.equal(nodeSatisfies('v26.12.1', '>=24.22.1 <25 || >=26.12.1'), true);
    assert.equal(nodeSatisfies('v22.22.3', '^22.19 || >=24'), true);
    assert.equal(nodeSatisfies('v20.0.0', '18 - 22'), true);
    assert.equal(nodeSatisfies('v24.0.0', '22.x'), false);
  });

  it('answers null for what it cannot read, never a wrong no', () => {
    assert.equal(nodeSatisfies('v24.0.0', '>=24.0.0-rc.1'), null);
    assert.equal(nodeSatisfies('garbage', '>=18'), null);
  });
});

describe('resolveInstallableVersion', () => {
  const info = {
    'dist-tags': { latest: '2026.10.8' },
    versions: {
      '2026.10.8': { engines: { node: '>=24.22.1 <25' } },
      '2026.10.6': { engines: { node: '>=24.22.1 <25' } },
      '2026.10.10-beta.4': { engines: { node: '>=20' } },
      '2026.10.5': { engines: { node: '>=24.16.0 <25' } },
      '2026.9.2': {},
    },
  };

  it('holds latest back to the newest stable release that runs', () => {
    assert.equal(resolveInstallableVersion(info, 'v24.21.0'), '2026.10.5');
  });

  it('keeps latest when it runs, or when the Node is unknown', () => {
    assert.equal(resolveInstallableVersion(info, 'v24.22.1'), '2026.10.8');
    assert.equal(resolveInstallableVersion(info, null), '2026.10.8');
  });

  it('keeps latest when nothing runs — npm then says why', () => {
    const strict = { 'dist-tags': { latest: '2.0.0' }, versions: { '2.0.0': { engines: { node: '>=99' } } } };
    assert.equal(resolveInstallableVersion(strict, 'v24.0.0'), '2.0.0');
  });
});

describe('unpinnedPackage', () => {
  it('only touches a spec that floats on latest', () => {
    assert.equal(unpinnedPackage('openclaw'), 'openclaw');
    assert.equal(unpinnedPackage('openclaw@latest'), 'openclaw');
    assert.equal(unpinnedPackage('@openai/codex'), '@openai/codex');
    assert.equal(unpinnedPackage('@openai/codex@latest'), '@openai/codex');
    assert.equal(unpinnedPackage('opencode-ai@1.17.11'), null);
    assert.equal(unpinnedPackage('@deepseek-ai/dsh@0.2.1-rc.2'), null);
  });
});

describe('Installer._holdBackForNode', () => {
  let server;
  let registry;
  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url !== '/openclaw') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        'dist-tags': { latest: '9.0.0' },
        versions: { '9.0.0': { engines: { node: '>=999' } }, '8.0.0': { engines: { node: '>=18' } } },
      }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    registry = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const installer = Object.create(Installer.prototype);

  it('rewrites an unpinned package to the release this Node runs, and says so', async () => {
    const out = [];
    const args = await installer._holdBackForNode(['openclaw@latest'], process.execPath, registry, (s) => out.push(s));
    assert.deepEqual(args, ['openclaw@8.0.0']);
    assert.match(out.join(''), /openclaw@9\.0\.0 requires Node >=999.*installing 8\.0\.0/s);
  });

  it('leaves a pinned spec, an unknown package and a missing node alone', async () => {
    assert.deepEqual(await installer._holdBackForNode(['openclaw@7.0.0'], process.execPath, registry), ['openclaw@7.0.0']);
    assert.deepEqual(await installer._holdBackForNode(['other'], process.execPath, registry), ['other']);
    assert.deepEqual(await installer._holdBackForNode(['openclaw'], '/no/such/node', registry), ['openclaw']);
  });
});
