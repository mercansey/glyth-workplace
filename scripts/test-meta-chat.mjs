// Direct Meta chat test through the SAME provider code the server uses.
// Run: node scripts/test-meta-chat.mjs   (reads .env, never prints the key)
try { process.loadEnvFile('.env'); } catch {}
const { MetaReasoningProvider } = await import('../src/ai/providers.js');
const provider = new MetaReasoningProvider({});
console.log(`configured=${provider.configured} model=${provider.model} base=${provider.baseUrl} timeoutMs=${provider.timeoutMs}`);
if (!provider.configured) { console.log('MODEL_API_KEY not loaded. Check .env'); process.exit(1); }
const { applyScenario, compileContext, validateReasoningResult } = await import('../src/domain/engine.js');
const { createFixtureState } = await import('../tests/fixture.js');
const appState = applyScenario(createFixtureState(), 'poor_sleep', { runOrchestration: false });
const appContext = compileContext(appState);
for (const [label, fn] of [
  ['chat (tiny)', () => provider.chat([{ role: 'user', content: 'Reply with the single word OK' }])],
  ['reason (structured)', () => provider.reason({ current_state: { sleepMinutes: 282 }, baselines: { sleepMinutes: 435 } })],
  ['reason (real app context)', async () => { const r = await provider.reason(appContext); const v = validateReasoningResult(r.parsed); console.log(`  validation: ${v.ok ? 'OK' : 'FAILED — ' + v.error}`); console.log(`  parsed keys: ${Object.keys(r.parsed || {}).join(', ')}`); console.log(`  confidence: ${JSON.stringify(r.parsed?.confidence)}  explanation type: ${typeof r.parsed?.explanation}`); if (!v.ok) console.log(`  raw parsed (first 600 chars): ${JSON.stringify(r.parsed).slice(0, 600)}`); return r; }],
]) {
  const t = Date.now();
  try { const r = await fn(); console.log(`${label}: OK in ${Date.now() - t}ms`, typeof r === 'string' ? JSON.stringify(r.slice(0, 60)) : `provider=${r.provider} latencyMs=${r.latencyMs}`); }
  catch (e) { console.log(`${label}: FAILED in ${Date.now() - t}ms — ${e.name}: ${String(e.message || e).slice(0, 300)}`); }
}
