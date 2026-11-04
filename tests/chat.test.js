import { test } from 'node:test'; import assert from 'node:assert/strict';
import { answerAsk, isMutationIntent } from '../src/ai/chat.js';
import { MetaReasoningProvider } from '../src/ai/providers.js';
import { createFixtureState } from './fixture.js';

test('Ask Glyth answers through Meta when configured, over compiled context', async () => {
  const s = createFixtureState(); let seen;
  const provider = { configured: true, name: 'meta', model: 'test-model', chat: async (msgs) => { seen = msgs; return 'Meta answer grounded in your context.'; } };
  const r = await answerAsk({ state: s, message: 'How is my week looking?', provider });
  assert.equal(r.source, 'meta'); assert.equal(s.conversation.at(-1).text, 'Meta answer grounded in your context.');
  assert.match(seen[1].content, /How is my week looking/); assert.match(seen[0].content, /Never claim you have changed/);
});
test('mutation intents never go to Meta: they stay typed proposals', async () => {
  const state2 = (await import('../src/domain/engine.js')).applyScenario(createFixtureState(), 'poor_sleep');
  const provider = { configured: true, name: 'meta', chat: async () => { throw new Error('must not be called'); } };
  const r = await answerAsk({ state: state2, message: 'Keep my workout', provider });
  assert.equal(r.source, 'deterministic-proposal'); assert.ok(state2.conversation.at(-1).proposal);
  assert.equal(isMutationIntent('Move admin to tomorrow'), true);
});
test('Meta chat failure is surfaced, never masked by a deterministic answer', async () => {
  const s = createFixtureState();
  const provider = { configured: true, name: 'meta', model: 'm', chat: async () => { throw new Error('Meta API 401: invalid key'); } };
  const r = await answerAsk({ state: s, message: 'What matters most today?', provider });
  assert.equal(r.source, 'llm-unavailable'); assert.match(s.conversation.at(-1).text, /couldn't reach the AI model/i); assert.match(s.conversation.at(-1).text, /401/); assert.equal(s.conversation.at(-1).source, 'llm-unavailable');
});
test('unconfigured provider tells the user instead of answering locally', async () => {
  const s = createFixtureState();
  const r = await answerAsk({ state: s, message: 'How is my week looking?', provider: { configured: false, name: 'deterministic' } });
  assert.equal(r.source, 'llm-unavailable'); assert.match(s.conversation.at(-1).text, /MODEL_API_KEY/);
});
test('family questions also go to the LLM, with family context included', async () => {
  const s = createFixtureState(); const FAM = await import('../src/family/family.js'); FAM.seedDemoFamily(s);
  let seen; const provider = { configured: true, name: 'meta', model: 'm', chat: async (msgs) => { seen = msgs; return 'LLM family answer.'; } };
  const r = await answerAsk({ state: s, message: "When is Mum's birthday?", provider });
  assert.equal(r.source, 'meta'); assert.equal(s.conversation.at(-1).text, 'LLM family answer.');
  assert.match(seen[1].content, /Mum/); assert.match(seen[1].content, /"family"/);
});
test('Meta chat provider parses a real chat completion shape', async () => {
  const pr = new MetaReasoningProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '  Hello from Meta  ' } }] }) }) });
  assert.equal(await pr.chat([{ role: 'user', content: 'hi' }]), 'Hello from Meta');
  const empty = new MetaReasoningProvider({ apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }) });
  await assert.rejects(() => empty.chat([]), /empty/);
  const denied = new MetaReasoningProvider({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid API key' } }) }) });
  await assert.rejects(() => denied.chat([]), /Meta API 401: invalid API key/);
});

test('chat replies are normalised: internal field names become plain language', async () => {
  const { normaliseChatText } = await import('../src/ai/chat.js');
  const out = normaliseChatText("Your `today_schedule` is empty and `last_reasoning` is null. **Reasoning:** no important_recent_signals.");
  assert.doesNotMatch(out, /today_schedule|last_reasoning|important_recent_signals|null|`/);
  assert.match(out, /today's schedule/); assert.match(out, /has not been recorded/);
});
test('normalised answer is what gets stored from the LLM', async () => {
  const s = createFixtureState();
  const provider = { configured: true, name: 'meta', model: 'm', chat: async () => 'All quiet: `today_schedule` has nothing at 14:00.' };
  const r = await answerAsk({ state: s, message: 'Anything at 2pm?', provider });
  assert.equal(r.source, 'meta'); assert.doesNotMatch(s.conversation.at(-1).text, /today_schedule/); assert.match(s.conversation.at(-1).text, /today's schedule/);
});
