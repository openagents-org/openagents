'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MIRRORS_PATH = require.resolve('../src/mirrors');

// A home without an .npmrc, so the suite measures our logic and not whatever
// registry the machine running it happens to have configured.
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-home-'));

/** Load mirrors.js fresh with a scripted environment (module reads env lazily). */
function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  delete require.cache[MIRRORS_PATH];
  try {
    fn(require('../src/mirrors'));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[MIRRORS_PATH];
  }
}

const BASE_ENV = {
  OPENAGENTS_NODE_MIRRORS: undefined,
  OPENAGENTS_NPM_MIRRORS: undefined,
  OPENAGENTS_DOWNLOAD_REGION: undefined,
  npm_config_registry: undefined,
  LANG: 'en_US.UTF-8',
  LC_ALL: undefined,
  HOME: EMPTY_HOME,
  USERPROFILE: EMPTY_HOME,
};

test('global region downloads from the official origins only', () => {
  withEnv({ ...BASE_ENV, OPENAGENTS_DOWNLOAD_REGION: 'global' }, (m) => {
    assert.deepStrictEqual(m.nodeDistUrls('v22.22.3/node.tar.gz'), [
      'https://nodejs.org/dist/v22.22.3/node.tar.gz',
    ]);
    assert.deepStrictEqual(m.npmUrls('pkg/latest'), [
      'https://registry.npmjs.org/pkg/latest',
    ]);
  });
});

test('china region tries mirrors first and official last', () => {
  withEnv({ ...BASE_ENV, OPENAGENTS_DOWNLOAD_REGION: 'cn' }, (m) => {
    const urls = m.nodeDistUrls('v22.22.3/node.tar.gz');
    assert.ok(urls[0].includes('npmmirror.com'));
    assert.strictEqual(urls[urls.length - 1], 'https://nodejs.org/dist/v22.22.3/node.tar.gz');
    assert.ok(m.npmUrls('pkg/latest').at(-1).startsWith('https://registry.npmjs.org/'));
  });
});

test('explicit mirror bases from the launcher win, with official still appended', () => {
  withEnv(
    {
      ...BASE_ENV,
      OPENAGENTS_DOWNLOAD_REGION: 'global',
      OPENAGENTS_NODE_MIRRORS: 'https://mirror.internal/node/ , not-a-url',
    },
    (m) => {
      assert.deepStrictEqual(m.nodeDistUrls('v22/node.tar.gz'), [
        'https://mirror.internal/node/v22/node.tar.gz',
        'https://nodejs.org/dist/v22/node.tar.gz',
      ]);
    }
  );
});

test('a zh_CN locale is enough to pick the mirror', () => {
  withEnv({ ...BASE_ENV, LANG: 'zh_CN.UTF-8' }, (m) => {
    assert.strictEqual(m.inChina(), true);
    assert.ok(m.nodeDistUrls('x').length > 1);
  });
});

test('npmRegistry honours an explicit npm_config_registry', () => {
  withEnv(
    { ...BASE_ENV, npm_config_registry: 'https://npm.internal/registry' },
    (m) => {
      assert.strictEqual(m.npmRegistry(), 'https://npm.internal/registry');
    }
  );
});

test('installRegistry only forces a mirror when it would actually help', () => {
  withEnv({ ...BASE_ENV, OPENAGENTS_DOWNLOAD_REGION: 'cn' }, (m) => {
    assert.ok(m.installRegistry().includes('npmmirror.com'));
  });
  withEnv({ ...BASE_ENV, OPENAGENTS_DOWNLOAD_REGION: 'global' }, (m) => {
    assert.strictEqual(m.installRegistry(), null);
  });
  // An explicit registry (launcher-injected or a corporate .npmrc) is honoured.
  withEnv(
    {
      ...BASE_ENV,
      OPENAGENTS_DOWNLOAD_REGION: 'cn',
      npm_config_registry: 'https://npm.internal/registry',
    },
    (m) => {
      assert.strictEqual(m.installRegistry(), null);
    }
  );
});

test('a registry in the user .npmrc is left alone', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-home-'));
  fs.writeFileSync(path.join(home, '.npmrc'), 'registry=https://npm.corp/internal\n');
  withEnv(
    { ...BASE_ENV, OPENAGENTS_DOWNLOAD_REGION: 'cn', HOME: home, USERPROFILE: home },
    (m) => {
      assert.strictEqual(m.userConfiguredRegistry(), 'https://npm.corp/internal');
      assert.strictEqual(m.installRegistry(), null);
    }
  );
});
