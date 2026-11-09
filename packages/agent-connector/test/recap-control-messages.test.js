'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isRecapEligible } = require('../src/adapters/decision-log');

describe('channel recap and control messages', () => {
  it('leaves a queue-cancel signal out of the recap', () => {
    assert.equal(isRecapEligible({ messageType: 'queue_cancel', content: '__queue_cancel:q-1' }, 'next'), false);
  });
  it('still includes ordinary chat', () => {
    assert.equal(isRecapEligible({ messageType: 'chat', content: 'please add issue boards' }, 'next'), true);
  });
});
