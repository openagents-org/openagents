/**
 * Gateway entry point.
 *
 * Two responsibilities that pull in opposite directions, which is why they are
 * separated everywhere below: the HTTP surface must answer a webhook in under
 * three seconds, and the workers must keep going for as long as an agent takes
 * to think. The handler's whole job is one durable write.
 */

import Fastify from 'fastify';

import { config } from './config.js';
import { migrate, one, close as closeDb } from './db.js';
import * as inbox from './inbox.js';
import * as outbox from './outbox.js';
import { log } from './log.js';
import { getPlatform, registeredPlatforms } from './platforms/types.js';
import { SubscriberPool } from './subscriber.js';

const app = Fastify({
  logger: false,
  // Signatures are computed over the exact bytes received, so a body Fastify
  // parsed and we re-serialised would not verify. Keep the original.
  bodyLimit: 10 * 1024 * 1024,
});

app.addContentTypeParser(
  ['application/json', 'application/x-www-form-urlencoded'],
  { parseAs: 'buffer' },
  (_req, body, done) => done(null, body),
);

const pool = new SubscriberPool();

app.get('/health', async () => ({ ok: true, platforms: registeredPlatforms() }));

/**
 * Webhook intake.
 *
 * Verify, decide whether it concerns us, write it down, acknowledge. Anything
 * that could take real time — downloading a file, reaching the workspace,
 * waiting on an agent — happens after the response has gone.
 */
app.post('/webhooks/:platform', async (req, reply) => {
  const platformId = (req.params as { platform: string }).platform;
  const platform = getPlatform(platformId);
  if (!platform) {
    return reply.code(404).send({ error: `unknown platform ${platformId}` });
  }

  const rawBody = req.body as Buffer;
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    body = rawBody.toString('utf-8');
  }
  const raw = { headers: req.headers, rawBody, body };

  const route = platform.identify(raw);
  if (!route) {
    // Unroutable, and retrying will not change that. 200 so the platform stops
    // redelivering something we can never place.
    log.warn({ platform: platformId }, 'webhook: could not identify installation');
    return reply.code(200).send({ ok: true });
  }

  const installationRow = await one(
    `SELECT id, platform, platform_app_id, tenant_id, credentials, metadata
       FROM platform_installations
      WHERE platform = $1 AND platform_app_id = $2 AND tenant_id = $3`,
    [platformId, route.platformAppId, route.tenantId],
  );
  if (!installationRow) {
    log.warn({ platform: platformId, ...route }, 'webhook: no such installation');
    return reply.code(200).send({ ok: true });
  }

  const { open } = await import('./crypto.js');
  const installation = {
    id: installationRow.id as string,
    platform: installationRow.platform as 'slack' | 'lark' | 'telegram',
    platformAppId: installationRow.platform_app_id as string,
    tenantId: installationRow.tenant_id as string,
    credentials: open<Record<string, unknown>>(installationRow.credentials as string),
    metadata: (installationRow.metadata as Record<string, unknown>) ?? {},
  };

  let verdict;
  try {
    verdict = await platform.handleWebhook(raw, installation);
  } catch (err) {
    // Verification failed. 401 rather than 200: this is not something to
    // redeliver, and a signature that does not check out should be loud.
    log.warn({ platform: platformId, err }, 'webhook: rejected');
    return reply.code(401).send({ error: 'invalid signature' });
  }

  if (verdict.kind === 'challenge') {
    return reply.code(200).send(verdict.response);
  }
  if (verdict.kind === 'ignore') {
    // The common case in a busy channel — everything not addressed to this
    // bot. Dropped here, so it never reaches the workspace at all.
    log.debug({ platform: platformId, reason: verdict.reason }, 'webhook: ignored');
    return reply.code(200).send({ ok: true });
  }

  const fresh = await inbox.accept({
    platform: platformId,
    installationId: installation.id,
    externalEventId: verdict.message.externalEventId,
    payload: { body },
  });

  // Acknowledged only after the row is committed. Doing it the other way round
  // is what turns a crash into a lost message: the platform would consider it
  // delivered and never send it again.
  reply.code(200).send({ ok: true });

  if (fresh) {
    void inbox.runDue().catch((err) => log.error({ err }, 'inbox: immediate run failed'));
  }
  return reply;
});

async function main(): Promise<void> {
  await migrate();
  log.info({ platforms: registeredPlatforms() }, 'gateway: schema ready');

  pool.start();

  // A background pass over both queues. The immediate paths — a webhook that
  // just arrived, a stream frame — handle the normal case; this is what
  // recovers work whose process died, and the only thing that retries.
  const sweep = setInterval(() => {
    void inbox.runDue().catch((err) => log.error({ err }, 'inbox: sweep failed'));
    void outbox.sendDue().catch((err) => log.error({ err }, 'outbox: sweep failed'));
  }, 15_000);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info({ port: config.port, publicUrl: config.publicUrl }, 'gateway: listening');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'gateway: shutting down');
    clearInterval(sweep);
    pool.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err }, 'gateway: failed to start');
  process.exit(1);
});
