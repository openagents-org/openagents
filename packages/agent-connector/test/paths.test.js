'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getExtraBinDirs, getEnhancedPATH, getEnhancedEnv, whichBinary, IS_WINDOWS } = require('../src/paths');

describe('Paths', () => {
  it('getExtraBinDirs returns array', () => {
    const dirs = getExtraBinDirs();
    assert.ok(Array.isArray(dirs));
  });

  it('getEnhancedPATH includes current PATH', () => {
    const enhanced = getEnhancedPATH();
    assert.ok(enhanced.includes(process.env.PATH || ''));
  });

  it('getEnhancedEnv returns object with PATH', () => {
    const env = getEnhancedEnv();
    assert.ok(typeof env === 'object');
    assert.ok(typeof env.PATH === 'string');
  });

  it('getEnhancedEnv merges base env', () => {
    const env = getEnhancedEnv({ FOO: 'bar', PATH: '/custom' });
    assert.equal(env.FOO, 'bar');
    assert.ok(env.PATH.includes('/custom'));
  });

  it('getEnhancedEnv sets UTF-8 vars on Windows', () => {
    if (!IS_WINDOWS) return; // skip on non-Windows
    const env = getEnhancedEnv();
    assert.equal(env.PYTHONIOENCODING, 'utf-8');
    assert.equal(env.PYTHONUTF8, '1');
  });

  it('whichBinary finds node', () => {
    const result = whichBinary('node');
    assert.ok(result, 'node should be found');
    assert.ok(result.includes('node'));
  });

  it('whichBinary returns null for nonexistent binary', () => {
    const result = whichBinary('definitely-not-a-real-binary-xyz');
    assert.equal(result, null);
  });

  it('whichBinary returns null for empty input', () => {
    assert.equal(whichBinary(''), null);
    assert.equal(whichBinary(null), null);
  });
});
