/**
 * Outbound queue: OA event → platform message.
 *
 * Two steps that must not be collapsed into one.
 *
 * **Drain** reads events the backend says are ours, writes them to the outbox,
 * and advances the cursor — all in one transaction. That is what makes the
 * cursor honest: it can never point past an event we have no record of, so a
 * crash between reading and sending costs a re-read rather than a lost reply.
 *
 * **Send** works from the outbox alone. A row exists before anything leaves,
 * and `(binding, oa event id)` is unique, so the same reply cannot be posted
 * twice however many times the drain runs.
 *
 * What remains is the last hop: a send that succeeds while its response is
 * lost. No platform offers a transactional way to close that, which is why the
 * guarantee is effectively-once rather than exactly-once.
 */

import { randomUUID } from 'node:crypto';

import { config } from './config.js';
import { backoffSeconds, one, query, transaction } from './db.js';
import { open } from './crypto.js';
import * as oa from './oa-client.js';
import { getPlatform, type Installation } from './platforms/types.js';
import { log } from './log.js';

const MAX_ATTEMPTS = 5;
const DRAIN_LIMIT = 100;
const SEND_BATCH = 10;

export interface ActiveBinding {
  id: string;
  installationId: string;
  integrationKey: string;
  cursor: string | null;
}

/**
 * Take the right to drain a binding.
 *
 * Both replicas run the same loop, and without this both would read from the
 * same cursor and race to move it — the loser's write would rewind it, and
 * events between the two positions would be delivered twice. A short lease
 * makes one of them the reader and lets the other skip; the lease expiring is
 * what covers a replica that dies holding it.
 */
export async function acquireLease(bindingId: string): Promise<boolean> {
  const rows = await query(
    `UPDATE bindings
        SET lease_owner = $2,
            lease_expires_at = NOW() + ($3 || ' seconds')::interval,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'active'
        AND (lease_owner IS NULL
             OR lease_owner = $2
             OR lease_expires_at < NOW())
      RETURNING id`,
    [bindingId, config.instanceId, String(config.leaseSeconds)],
  );
  return rows.length > 0;
}

export async function releaseLease(bindingId: string): Promise<void> {
  await query(
    `UPDATE bindings
        SET lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
      WHERE id = $1 AND lease_owner = $2`,
    [bindingId, config.instanceId],
  );
}

export async function activeBindings(): Promise<ActiveBinding[]> {
  const rows = await query(
    `SELECT id, installation_id, integration_key, cursor
       FROM bindings WHERE status = 'active'`,
  );
  return rows.map((row) => ({
    id: row.id as string,
    installationId: row.installation_id as string,
    integrationKey: open<string>(row.integration_key as string),
    cursor: (row.cursor as string | null) ?? null,
  }));
}

/**
 * Pull everything waiting for one binding into the outbox.
 *
 * Repeats while the backend reports more, so a binding that fell behind
 * catches up in one pass instead of one page per wake-up.
 */
export async function drain(binding: ActiveBinding): Promise<number> {
  if (!(await acquireLease(binding.id))) return 0;

  let cursor = binding.cursor;
  let queued = 0;

  for (;;) {
    const page = await oa.fetchOutbound(binding.integrationKey, {
      after: cursor,
      limit: DRAIN_LIMIT,
    });

    if (page.events.length === 0 && page.next_cursor === cursor) break;

    await transaction(async (client) => {
      for (const event of page.events) {
        const result = await client.query(
          `INSERT INTO outbound_deliveries
             (id, binding_id, oa_event_id, external_key, payload)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (binding_id, oa_event_id) DO NOTHING
           RETURNING id`,
          [
            randomUUID(),
            binding.id,
            event.id,
            event.external_key,
            JSON.stringify({
              author: event.author,
              content: event.content,
              attachments: event.attachments,
              channel_name: event.channel_name,
            }),
          ],
        );
        if (result.rows.length > 0) queued++;
      }

      // Same transaction as the inserts above. Separately, a crash in between
      // would leave the cursor past events with no outbox row — a silently
      // dropped reply, which is the exact failure this design exists to rule
      // out.
      await client.query(
        `UPDATE bindings SET cursor = $2, updated_at = NOW() WHERE id = $1`,
        [binding.id, page.next_cursor],
      );
    });

    cursor = page.next_cursor;
    if (!page.has_more) break;
  }

  return queued;
}

async function loadInstallation(id: string): Promise<Installation | null> {
  const row = await one(
    `SELECT id, platform, platform_app_id, tenant_id, credentials, metadata
       FROM platform_installations WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id as string,
    platform: row.platform as Installation['platform'],
    platformAppId: row.platform_app_id as string,
    tenantId: row.tenant_id as string,
    credentials: open<Record<string, unknown>>(row.credentials as string),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

interface PendingSend {
  id: string;
  binding_id: string;
  installation_id: string;
  oa_event_id: string;
  external_key: string | null;
  payload: { author: { kind: 'agent' | 'human' | 'system'; name: string }; content: string };
  attempts: number;
}

async function claimSends(limit: number): Promise<PendingSend[]> {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT o.id, o.binding_id, o.oa_event_id, o.external_key, o.payload, o.attempts,
              b.installation_id
         FROM outbound_deliveries o
         JOIN bindings b ON b.id = o.binding_id
        WHERE o.status IN ('pending', 'running')
          AND o.next_attempt_at <= NOW()
        ORDER BY o.next_attempt_at ASC
        LIMIT $1
        FOR UPDATE OF o SKIP LOCKED`,
      [limit],
    );
    if (rows.length === 0) return [];

    await client.query(
      `UPDATE outbound_deliveries
          SET status = 'running', attempts = attempts + 1, updated_at = NOW()
        WHERE id = ANY($1::text[])`,
      [rows.map((r) => r.id as string)],
    );
    return rows as PendingSend[];
  });
}

/** Send whatever is due. Never throws. */
export async function sendDue(limit = SEND_BATCH): Promise<number> {
  let rows: PendingSend[];
  try {
    rows = await claimSends(limit);
  } catch (err) {
    log.error({ err }, 'outbox: could not claim sends');
    return 0;
  }

  let sent = 0;
  for (const row of rows) {
    try {
      if (!row.external_key) {
        // No conversation to reply into. Nothing to retry towards, so record
        // it as failed rather than looping.
        throw Object.assign(new Error('event has no external conversation'), {
          permanent: true,
        });
      }

      const installation = await loadInstallation(row.installation_id);
      if (!installation) {
        throw Object.assign(new Error('installation is gone'), { permanent: true });
      }
      const platform = getPlatform(installation.platform);
      if (!platform) {
        throw Object.assign(
          new Error(`no adapter registered for ${installation.platform}`),
          { permanent: true },
        );
      }

      const result = await platform.send(installation, {
        externalKey: row.external_key,
        author: row.payload.author,
        text: row.payload.content,
      });

      await query(
        `UPDATE outbound_deliveries
            SET status = 'done', external_message_id = $2,
                last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [row.id, result.externalMessageId],
      );
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = Boolean((err as { permanent?: boolean })?.permanent);
      const attempts = row.attempts + 1;
      const exhausted = permanent || attempts >= MAX_ATTEMPTS;

      await query(
        `UPDATE outbound_deliveries
            SET status = $2,
                last_error = $3,
                next_attempt_at = NOW() + ($4 || ' seconds')::interval,
                updated_at = NOW()
          WHERE id = $1`,
        [
          row.id,
          exhausted ? 'failed' : 'pending',
          message.slice(0, 500),
          String(backoffSeconds(attempts)),
        ],
      );

      if (exhausted) {
        log.error({ delivery: row.id, attempts, err: message }, 'outbox: giving up');
      } else {
        log.warn({ delivery: row.id, attempts, err: message }, 'outbox: will retry');
      }
    }
  }
  return sent;
}

/**
 * Flush what is left for a binding being disconnected.
 *
 * The user asked to stop, but a reply already produced and already recorded
 * should still reach them — dropping it is a message that vanishes with no
 * trace on either side. Bounded, because a disconnect must complete.
 */
export async function flushForDisconnect(bindingId: string): Promise<number> {
  const deadline = Date.now() + 30_000;
  let flushed = 0;
  for (;;) {
    const pending = await one(
      `SELECT COUNT(*)::int AS n FROM outbound_deliveries
        WHERE binding_id = $1 AND status IN ('pending', 'running')`,
      [bindingId],
    );
    if (!pending || (pending.n as number) === 0) break;
    if (Date.now() > deadline) {
      log.warn({ binding: bindingId }, 'outbox: flush window elapsed, abandoning the rest');
      break;
    }
    flushed += await sendDue();
  }
  return flushed;
}
