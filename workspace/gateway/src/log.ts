/**
 * Minimal structured logging.
 *
 * One line of JSON per event, so Railway's log search can filter on binding or
 * delivery id when something needs tracing across the two queues.
 */

import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(config.logLevel as Level)] ?? ORDER.info;

function emit(level: Level, fields: Record<string, unknown>, message: string): void {
  if (ORDER[level] < threshold) return;
  const err = fields.err;
  const line = {
    level,
    msg: message,
    ...fields,
    ...(err instanceof Error ? { err: err.message, stack: err.stack } : {}),
    time: new Date().toISOString(),
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  debug: (fields: Record<string, unknown>, message: string) => emit('debug', fields, message),
  info: (fields: Record<string, unknown>, message: string) => emit('info', fields, message),
  warn: (fields: Record<string, unknown>, message: string) => emit('warn', fields, message),
  error: (fields: Record<string, unknown>, message: string) => emit('error', fields, message),
};
