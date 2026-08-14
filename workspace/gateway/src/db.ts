/**
 * Postgres access and the queue primitives built on it.
 *
 * There is no Redis here on purpose. Everything the gateway must not lose —
 * inbound deliveries, outbound sends, cursors — needs to survive a restart,
 * and `FOR UPDATE SKIP LOCKED` gives us competing consumers without a second
 * piece of infrastructure to operate. Redis would buy speed we do not need:
 * the slow part of this system is an agent thinking, measured in seconds.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Run a function inside a transaction, rolling back on any throw.
 *
 * Used wherever two writes have to agree — claiming a delivery and recording
 * its outcome, or inserting an outbox batch and advancing the cursor that
 * covers it.
 */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply the schema.
 *
 * A single idempotent file rather than a migration tool: the gateway owns its
 * own database, the schema is four tables, and `CREATE TABLE IF NOT EXISTS`
 * covers the whole of it. When that stops being true, this is the place to
 * introduce something with versioning.
 */
export async function migrate(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '..', 'migrations', '001_init.sql');
  const sql = await readFile(file, 'utf-8');
  await pool.query(sql);
}

/** Exponential-ish backoff, capped. Shared by both queues. */
export function backoffSeconds(attempts: number): number {
  const ladder = [5, 30, 120, 600];
  return ladder[Math.min(Math.max(attempts - 1, 0), ladder.length - 1)]!;
}

export async function close(): Promise<void> {
  await pool.end();
}
