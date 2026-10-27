// ReasoningProvider abstraction. Meta is the primary provider; the
// deterministic provider is the authoritative fallback so the demo never
// depends on a network call. Docs checked 2026-10-26:
// Meta Model API — https://api.meta.ai/v1, Authorization: Bearer $MODEL_API_KEY,
// OpenAI-compatible /chat/completions, model id via META_MODEL (e.g. muse-spark-1.1).
export class DeterministicProvider {
  constructor() { this.name = 'deterministic'; }
  async reason(_ctx, fallbackNote) { return { ok: true, provider: this.name, note: fallbackNote || 'Deterministic rules produced this plan. Connect Meta to enrich the explanation.', latencyMs: 0, validated: true }; }
}
export class MetaReasoningProvider {
  constructor({ apiKey, model, baseUrl, fetchImpl } = {}) {
    this.name = 'meta';
    this.apiKey = apiKey || process.env.MODEL_API_KEY || '';
    this.model = model || process.env.META_MODEL || 'muse-spark-1.1';
    this.baseUrl = (baseUrl || process.env.META_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
    this.fetchImpl = fetchImpl || fetch;
  }
  get configured() { return Boolean(this.apiKey); }
  async reason(ctx) {
    if (!this.configured) throw new Error('MODEL_API_KEY not configured');
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, temperature: 0.2, messages: [
        { role: 'system', content: 'You are a reasoning enricher for a daily-planning system. Return ONLY JSON matching: {"observations":[],"affectedAreas":[],"recommendations":[],"explanation":""}. Never invent medical claims. Application rules are authoritative.' },
        { role: 'user', content: JSON.stringify(ctx) },
      ] }),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('Meta returned non-JSON'); }
    return { ok: true, provider: this.name, model: this.model, parsed, latencyMs: Date.now() - started, validated: true };
  }
}
export function createProvider(env = process.env) {
  return env.MODEL_API_KEY ? new MetaReasoningProvider({}) : new DeterministicProvider();
}
