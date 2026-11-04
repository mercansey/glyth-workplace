import { test } from 'node:test'; import assert from 'node:assert/strict';
import { normalizeUnipileMessage, upsertCommunicationMessage, communicationContext, parseDeepLink, needsReplyFor } from '../src/comms/comms.js';
import { nativeCapabilities } from '../src/native/bridge.js';

test('message normalisation keeps provenance and rejects unknown providers', () => {
  const m = normalizeUnipileMessage({ provider: 'instagram', chat_id: 'c1', id: 'm1', body: 'Hi there', sent_at: '2026-11-03T09:00:00Z', sender_name: 'Alex' });
  assert.equal(m.provider_message_id, 'm1'); assert.equal(m.direction, 'inbound'); assert.equal(m.body, 'Hi there');
  assert.throws(() => normalizeUnipileMessage({ provider: 'telegram', id: 'x', chat_id: 'c' }), /unsupported/);
});
test('webhook idempotency: same message twice is one message, one thread, needs_reply set', () => {
  const store = { accounts: [], threads: [], messages: [] };
  const raw = { provider: 'whatsapp', chat_id: 'c9', id: 'mm1', body: 'Are we still on?', sent_at: '2026-11-03T10:00:00Z', sender_name: 'Sam' };
  upsertCommunicationMessage(store, 'user1', 'acc1', normalizeUnipileMessage(raw));
  const second = upsertCommunicationMessage(store, 'user1', 'acc1', normalizeUnipileMessage(raw));
  assert.equal(store.messages.length, 1); assert.equal(store.threads.length, 1); assert.equal(store.threads[0].needs_reply, true);
  upsertCommunicationMessage(store, 'user1', 'acc1', normalizeUnipileMessage({ provider: 'whatsapp', chat_id: 'c9', id: 'mm2', body: 'Yes!', direction: 'outbound', sent_at: '2026-11-03T10:05:00Z' }));
  assert.equal(store.threads[0].needs_reply, false);
  assert.equal(store.threads[0].last_message_preview, 'Yes!'); // latest, never the first historical message
});
test('communication context is derived summaries only', () => {
  const store = { accounts: [], threads: [{ id: 't1', user_id: 'u', provider: 'instagram', needs_reply: true, last_message_at: 'x' }], messages: [] };
  const ctx = communicationContext(store, 'u'); assert.equal(ctx.unanswered_thread_count, 1); assert.ok(!('body' in ctx)); assert.equal(ctx.privacy_class, 'PRIVATE_CONVERSATION');
});
test('deep links parse to app surfaces; unknown falls back to Today', () => {
  assert.deepEqual(parseDeepLink('https://app.example/messages/ct_1'), { view: 'messages', threadId: 'ct_1' });
  assert.deepEqual(parseDeepLink('https://app.example/insights'), { view: 'insights' });
  assert.deepEqual(parseDeepLink('not a url'), { view: 'today' });
  assert.equal(needsReplyFor([]), false);
});
test('web native capabilities are unsupported, never fake success', async () => {
  const caps = await nativeCapabilities(); assert.equal(caps.platform, 'web'); assert.equal(caps.healthKit, false);
});

import { sendPush, apnsConfigured } from '../src/comms/push.js';
import { buildContributions } from '../src/bridge/bridge.js';
test('APNs sender reports unconfigured honestly, never fake-sends', async () => {
  assert.equal(apnsConfigured({}), false);
  assert.deepEqual(await sendPush({ tokens: ['t'], title: 'x', body: 'y' }, {}), { configured: false, sent: 0 });
});
test('employer bridge drops health, message and calendar payloads by construction', () => {
  const { contributions, dropped } = buildContributions({ userId: 'u1', orgId: 'o1', teamId: 't1', day: '2026-11-03', salt: 's',
    signals: { workload: 60, sleep: 282, body: 'private message', calendar_title: 'Investor meeting', recovery: 43 }, consentedCategories: ['workload', 'sleep', 'body'] });
  assert.equal(contributions.length, 1); assert.equal(contributions[0].category, 'workload');
  for (const k of ['sleep', 'body', 'calendar_title', 'recovery']) assert.ok(dropped.includes(k), k);
});

import { UnipileClient } from '../src/comms/unipile.js';
test('Unipile URL construction respects a versioned DSN and a legacy DSN', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => ({}) }; };
  await new UnipileClient({ apiKey: 'k', dsn: 'https://api.unipile.com/v2', version: 'v1', fetchImpl }).listChats('acc');
  await new UnipileClient({ apiKey: 'k', dsn: 'https://api1.unipile.com:13111', fetchImpl }).listChats('acc');
  assert.equal(urls[0], 'https://api.unipile.com/v2/chats?account_id=acc&limit=25');
  assert.equal(urls[1], 'https://api1.unipile.com:13111/api/v1/chats?account_id=acc&limit=25');
});

test('hosted auth: create never sends account_id (the acc_ 400 bug), reconnect sends only a valid acc_ id', async () => {
  let body; const client = new UnipileClient({ apiKey: 'k', dsn: 'https://api.unipile.com/v2', version: 'v1', fetchImpl: async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ url: 'https://auth.example' }) }; } });
  await client.hostedAuthLink({ userId: 'user-1', provider: 'whatsapp', accountId: 'acc_123' });
  assert.ok(!('account_id' in body)); assert.deepEqual(body.providers, ['WHATSAPP']); assert.equal(body.type, 'create');
  assert.ok(!('success_redirect_url' in body));
  await client.hostedAuthLink({ userId: 'user-1', provider: 'whatsapp', type: 'reconnect', accountId: 'acc_123' });
  assert.equal(body.account_id, 'acc_123');
  await client.hostedAuthLink({ userId: 'user-1', provider: 'whatsapp', type: 'reconnect', accountId: 'stale-workspace-id' });
  assert.ok(!('account_id' in body));
});

test('Unipile v2 hosted auth: creates a scope, then /auth/link with lowercase provider + account_scope_id', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); if (url.endsWith('/scopes/')) return { ok: true, json: async () => ({ id: 'scope_1' }) }; return { ok: true, json: async () => ({ url: 'https://auth.example' }) }; };
  const client = new UnipileClient({ apiKey: 'k', dsn: 'https://api.unipile.com/v2', fetchImpl });
  const link = await client.hostedAuthLink({ userId: 'user-1', provider: 'whatsapp', successUrl: 'http://127.0.0.1:3000/' });
  assert.equal(link.url, 'https://auth.example');
  assert.equal(calls[0].url, 'https://api.unipile.com/v2/scopes/');
  assert.equal(calls[1].url, 'https://api.unipile.com/v2/auth/link');
  assert.deepEqual(calls[1].body.providers, ['whatsapp']); assert.equal(calls[1].body.account_scope_id, 'scope_1');
  assert.ok(!('account_id' in calls[1].body)); assert.ok(calls[1].body.state); assert.equal(calls[1].body.redirect_uri, 'http://127.0.0.1:3000/');
});
test('Unipile v2 messaging is account-scoped in the URL and rejects non-acc ids locally', async () => {
  const urls = [];
  const client = new UnipileClient({ apiKey: 'k', dsn: 'https://api.unipile.com/v2', fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => ({}) }; } });
  await client.listChats('acc_123'); await client.listMessages('c1', 25, 'acc_123'); await client.sendMessage({ chatId: 'c1', accountId: 'acc_123', text: 'hi' });
  assert.equal(urls[0], 'https://api.unipile.com/v2/acc_123/chats?limit=25');
  assert.equal(urls[1], 'https://api.unipile.com/v2/acc_123/chats/c1/messages?limit=25');
  assert.equal(urls[2], 'https://api.unipile.com/v2/acc_123/chats/c1/messages/send');
  assert.throws(() => client.listChats('demo'), /reconnected/);
});
