'use strict';

const { StringDecoder } = require('node:string_decoder');

// Process JSONL events in order, including async Workspace posts. A handler
// can inspect the next event if stdout has already delivered it. Never delay
// a progress update to wait for more output.
function createCliEventQueue(handleEvent) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let pending = Promise.resolve();
  let last = null;

  function enqueue(line) {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { event = null; }
    const entry = { next: null };
    if (last) last.next = event;
    last = entry;
    if (event) pending = pending.then(() => handleEvent(event, entry.next)).catch(() => {});
  }

  return {
    write(chunk) {
      buffer += decoder.write(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) enqueue(line);
    },
    finish() {
      enqueue(buffer + decoder.end());
      buffer = '';
      return pending;
    },
  };
}

module.exports = { createCliEventQueue };
