import test from 'node:test';
import assert from 'node:assert';
import { createHmac, randomBytes } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://unused';
process.env.OA_ENDPOINT ??= 'http://unused';
process.env.OA_SERVICE_KEY ??= 'unused';
process.env.GATEWAY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

const { slackAdapter, appManifest } = await import('../src/platforms/slack.js');
import type { Installation, RawWebhook } from '../src/platforms/types.js';

const SIGNING_SECRET = 'test-signing-secret';
const BOT_USER = 'U-BOT';

const installation: Installation = {
  id: 'inst-1',
  platform: 'slack',
  platformAppId: 'A123',
  tenantId: 'T123',
  credentials: {
    botToken: 'xoxb-test',
    signingSecret: SIGNING_SECRET,
    botUserId: BOT_USER,
  },
  metadata: { oaAgentName: 'ops-bot' },
};

function signed(body: unknown, { age = 0 } = {}): RawWebhook {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf-8');
  const timestamp = String(Math.floor(Date.now() / 1000) - age);
  const signature =
    'v0=' +
    createHmac('sha256', SIGNING_SECRET)
      .update(`v0:${timestamp}:${rawBody.toString('utf-8')}`)
      .digest('hex');
  return {
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    rawBody,
    body,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    type: 'event_callback',
    event_id: 'Ev123',
    team_id: 'T123',
    api_app_id: 'A123',
    event: {
      type: 'message',
      channel: 'C-OPS',
      channel_type: 'channel',
      user: 'U-ALICE',
      ts: '1700.1',
      text: `<@${BOT_USER}> deploy status?`,
      ...overrides,
    },
  };
}

test('routing identifies the app as well as the workspace', () => {
  // With one app per agent, several of ours live in the same Slack workspace —
  // team_id alone would not say which agent a message is for.
  assert.deepStrictEqual(slackAdapter.identify(signed(event())), {
    platformAppId: 'A123',
    tenantId: 'T123',
  });
});

test('an unsigned request is rejected', async () => {
  const raw = signed(event());
  raw.headers['x-slack-signature'] = 'v0=deadbeef';
  await assert.rejects(() => slackAdapter.handleWebhook(raw, installation));
});

test('a signature outside the replay window is rejected', async () => {
  // A captured request would otherwise stay valid forever, and its signature
  // is genuine.
  await assert.rejects(
    () => slackAdapter.handleWebhook(signed(event(), { age: 60 * 10 }), installation),
    /replay window/,
  );
});

test('the URL verification handshake is answered', async () => {
  const verdict = await slackAdapter.handleWebhook(
    signed({ type: 'url_verification', challenge: 'abc', api_app_id: 'A123', team_id: 'T123' }),
    installation,
  );
  assert.strictEqual(verdict.kind, 'challenge');
  assert.deepStrictEqual(verdict.response, { challenge: 'abc' });
});

test('a mention in a channel becomes a thread', async () => {
  // Replies go in a thread, so a mention that is not already in one starts a
  // thread rooted at itself.
  const verdict = await slackAdapter.handleWebhook(signed(event()), installation);
  assert.strictEqual(verdict.kind, 'message');
  assert.deepStrictEqual(verdict.message.conversation, {
    kind: 'thread',
    tenantId: 'T123',
    conversationId: 'C-OPS',
    threadId: '1700.1',
    title: 'Slack thread',
  });
  assert.strictEqual(verdict.message.text, 'deploy status?', 'the bot handle is stripped');
});

test('channel chatter without a mention is dropped', async () => {
  // The requirement, and the reason a busy channel does not flood the agent.
  const verdict = await slackAdapter.handleWebhook(
    signed(event({ text: 'unrelated conversation' })),
    installation,
  );
  assert.strictEqual(verdict.kind, 'ignore');
});

test('a follow-up inside a thread needs no mention', async () => {
  // Slack does not repeat the mention on replies; requiring one would make the
  // bot answer once and then go silent for the rest of the conversation.
  const verdict = await slackAdapter.handleWebhook(
    signed(event({ text: 'and the database?', thread_ts: '1700.1', ts: '1700.5' })),
    installation,
  );
  assert.strictEqual(verdict.kind, 'message');
  assert.strictEqual(verdict.message.conversation.threadId, '1700.1');
});

test('app_mention is dropped as a duplicate of the message event', async () => {
  // Slack delivers both for the same mention; keeping either one twice would
  // make the agent answer twice.
  const verdict = await slackAdapter.handleWebhook(
    signed(event({ type: 'app_mention' })),
    installation,
  );
  assert.strictEqual(verdict.kind, 'ignore');
});

test('a direct message is one rolling conversation, not a thread', async () => {
  const verdict = await slackAdapter.handleWebhook(
    signed(event({ channel: 'D-ALICE', channel_type: 'im', text: 'hello' })),
    installation,
  );
  assert.strictEqual(verdict.kind, 'message');
  assert.strictEqual(verdict.message.conversation.kind, 'dm');
  assert.strictEqual(verdict.message.conversation.conversationId, 'D-ALICE');
});

test("the bot's own messages are ignored", async () => {
  // Our replies come back to us; echoing them would loop.
  const fromBot = await slackAdapter.handleWebhook(
    signed(event({ bot_id: 'B123', text: 'my own reply' })),
    installation,
  );
  assert.strictEqual(fromBot.kind, 'ignore');

  const fromBotUser = await slackAdapter.handleWebhook(
    signed(event({ user: BOT_USER, channel_type: 'im' })),
    installation,
  );
  assert.strictEqual(fromBotUser.kind, 'ignore');
});

test('edits and joins are ignored', async () => {
  for (const subtype of ['message_changed', 'message_deleted', 'channel_join']) {
    const verdict = await slackAdapter.handleWebhook(
      signed(event({ subtype })),
      installation,
    );
    assert.strictEqual(verdict.kind, 'ignore', `${subtype} should be ignored`);
  }
});

test('attachments are carried through with a way to fetch them', async () => {
  const verdict = await slackAdapter.handleWebhook(
    signed(event({
      files: [{ id: 'F1', name: 'log.txt', mimetype: 'text/plain', url_private: 'https://files.slack.com/x' }],
    })),
    installation,
  );
  assert.strictEqual(verdict.kind, 'message');
  const [attachment] = verdict.message.attachments;
  assert.strictEqual(attachment?.externalFileId, 'F1');
  assert.strictEqual(attachment?.filename, 'log.txt');
  // Slack files are private, so a URL alone would be useless to the backend.
  assert.strictEqual(typeof attachment?.download, 'function');
});

test('an event with no id is dropped', async () => {
  // Nothing to deduplicate on means a retry would post twice.
  const raw = signed({ ...event(), event_id: undefined });
  const verdict = await slackAdapter.handleWebhook(raw, installation);
  assert.strictEqual(verdict.kind, 'ignore');
});

test('the manifest names the app after the agent', () => {
  const manifest = appManifest({ agentName: 'ops-bot', publicUrl: 'https://gw.example' }) as {
    display_information: { name: string };
    settings: { event_subscriptions: { request_url: string } };
  };
  assert.strictEqual(manifest.display_information.name, 'ops-bot');
  assert.strictEqual(
    manifest.settings.event_subscriptions.request_url,
    'https://gw.example/webhooks/slack',
  );
});
