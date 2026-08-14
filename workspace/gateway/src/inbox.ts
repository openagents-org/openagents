/**
 * Inbound queue: platform webhook → OA message.
 *
 * Slack gives a webhook three seconds to return 2xx and retries when it does
 * not, while an agent takes tens of seconds to answer. So the request handler
 * does exactly one durable write and returns; everything after that is a
 * worker's problem.
 *
 * The unique key on (platform, installation, external event id) is what makes
 * a platform retry harmless: the second delivery collides here and never
 * reaches the workspace. It is scoped to the installation because Slack's
 * event ids are globally unique but Telegram's update ids are a per-bot
 * sequence — one key has to work for both.
 */

import { randomUUID } from 'node:crypto';

import { backoffSeconds, one, query, transaction } from './db.js';
import { open } from './crypto.js';
import * as oa from './oa-client.js';
import { getPlatform, type Installation } from './platforms/types.js';
import { log } from './log.js';

const MAX_ATTEMPTS = 5;
const BATCH = 10;

export interface InboundRow {
  id: string;
  platform: string;
  installation_id: string;
  external_event_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Record a webhook. Call this *before* acknowledging it.
 *
 * Returns false when we have seen this event already, which is a retry rather
 * than an error — the caller still acknowledges, or the platform keeps
 * redelivering something we already handled.
 */
export async function accept(params: {
  platform: string;
  installationId: string;
  externalEventId: string;
  payload: unknown;
}): Promise<boolean> {
  const rows = await query(
    `INSERT INTO inbound_deliveries
       (id, platform, installation_id, external_event_id, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (platform, installation_id, external_event_id) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      params.platform,
      params.installationId,
      params.externalEventId,
      JSON.stringify(params.payload),
    ],
  );
  return rows.length > 0;
}

async function claim(limit: number): Promise<InboundRow[]> {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, platform, installation_id, external_event_id, payload, attempts
         FROM inbound_deliveries
        WHERE status IN ('pending', 'running')
          AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id as string);
    await client.query(
      `UPDATE inbound_deliveries
          SET status = 'running', attempts = attempts + 1, updated_at = NOW()
        WHERE id = ANY($1::text[])`,
      [ids],
    );
    return rows as InboundRow[];
  });
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

/**
 * The binding a webhook belongs to.
 *
 * One installation carries one binding — an exported agent gets its own
 * platform app, so "which agent should answer" has a single answer and never
 * needs to be inferred from the message.
 */
async function loadBinding(
  installationId: string,
): Promise<{ id: string; integrationKey: string } | null> {
  const row = await one(
    `SELECT id, integration_key
       FROM bindings
      WHERE installation_id = $1 AND status = 'active'
      LIMIT 1`,
    [installationId],
  );
  if (!row) return null;
  return {
    id: row.id as string,
    integrationKey: open<string>(row.integration_key as string),
  };
}

async function deliver(row: InboundRow): Promise<void> {
  const installation = await loadInstallation(row.installation_id);
  if (!installation) throw new Error(`installation ${row.installation_id} is gone`);

  const binding = await loadBinding(installation.id);
  if (!binding) {
    // Disconnected between the webhook arriving and this running. Not a
    // failure — there is simply nowhere for it to go now.
    log.info({ delivery: row.id }, 'inbox: no active binding, dropping');
    return;
  }

  const platform = getPlatform(row.platform);
  if (!platform) throw new Error(`no adapter registered for ${row.platform}`);

  const verdict = await platform.handleWebhook(
    {
      headers: {},
      rawBody: Buffer.alloc(0),
      body: row.payload.body ?? row.payload,
    },
    installation,
  );
  if (verdict.kind !== 'message') return;

  const message = verdict.message;

  // Attachments first, then one ingest carrying their ids. The order matters:
  // ingest is the only thing that creates a message, so a failure here leaves
  // stored files with nothing pointing at them rather than a half-formed
  // conversation. The backend reclaims those on its own.
  const fileIds: string[] = [];
  for (const attachment of message.attachments) {
    const data = await attachment.download();
    const stored = await oa.uploadFile(binding.integrationKey, {
      filename: attachment.filename,
      contentType: attachment.contentType,
      data,
      platformEventId: message.externalEventId,
      platformFileId: attachment.externalFileId,
    });
    fileIds.push(stored.file_id);
  }

  const result = await oa.ingest(binding.integrationKey, {
    conversation: {
      kind: message.conversation.kind,
      tenant_id: message.conversation.tenantId,
      conversation_id: message.conversation.conversationId,
      thread_id: message.conversation.threadId ?? null,
      title: message.conversation.title ?? null,
    },
    sender: {
      external_user_id: message.sender.externalUserId,
      display_name: message.sender.displayName,
    },
    content: message.text,
    fileIds,
    idempotencyKey: message.externalEventId,
  });

  await query(
    `UPDATE inbound_deliveries SET oa_event_id = $2, updated_at = NOW() WHERE id = $1`,
    [row.id, result.event_id],
  );
}

/** Process whatever is due. Never throws. */
export async function runDue(limit = BATCH): Promise<number> {
  let rows: InboundRow[];
  try {
    rows = await claim(limit);
  } catch (err) {
    log.error({ err }, 'inbox: could not claim deliveries');
    return 0;
  }

  let handled = 0;
  for (const row of rows) {
    try {
      await deliver(row);
      await query(
        `UPDATE inbound_deliveries
            SET status = 'done', last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [row.id],
      );
      handled++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = !(err instanceof oa.OaError) || err.retryable;
      const attempts = row.attempts + 1;
      const exhausted = !retryable || attempts >= MAX_ATTEMPTS;

      await query(
        `UPDATE inbound_deliveries
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
        log.error(
          { delivery: row.id, attempts, err: message },
          'inbox: giving up on delivery',
        );
      } else {
        log.warn(
          { delivery: row.id, attempts, err: message },
          'inbox: delivery failed, will retry',
        );
      }
    }
  }
  return handled;
}
