// ReasoningProvider abstraction. Meta is the primary provider; the
// deterministic provider is the authoritative fallback so the demo never
// depends on a network call. Docs checked 2026-10-26:
// Meta Model API — https://api.meta.ai/v1, Authorization: Bearer $MODEL_API_KEY,
// OpenAI-compatible /chat/completions, model id via META_MODEL (e.g. muse-spark-1.1).
async function metaError(res) { let detail = ''; try { const d = await res.json(); detail = String(d?.error?.message || d?.error || d?.message || '').slice(0, 200); } catch { /* non-JSON error body */ } return new Error(`Meta API ${res.status}${detail ? `: ${detail}` : ''}`); }
export class DeterministicProvider {
  constructor() { this.name = 'deterministic'; this.configured = false; }
  async chat() { return null; }
  async reason(_ctx, fallbackNote) { return { ok: true, provider: this.name, note: fallbackNote || 'Deterministic rules produced this plan. Connect Meta to enrich the explanation.', latencyMs: 0, validated: true }; }
}
export class MetaReasoningProvider {
  constructor({ apiKey, model, baseUrl, fetchImpl, timeoutMs = Number(process.env.META_TIMEOUT_MS || 30000) } = {}) { this.timeoutMs = timeoutMs;
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
    const payload = { model: this.model, temperature: 0.2, messages: [
      { role: 'system', content: 'You are a reasoning enricher for a daily-planning system. Return ONLY JSON matching: {"observations":[],"affectedAreas":[],"hypotheses":[],"recommendations":[],"priorityChanges":[],"planChanges":[],"explanation":{"summary":""},"confidence":0}. Confidence is 0-1. Never invent medical claims. Application rules are authoritative; do not propose moving critical commitments.' },
      { role: 'user', content: JSON.stringify(ctx) },
    ] };
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) { // one retry maximum
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST', ...(ctrl ? { signal: ctrl.signal } : {}),
          headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { lastErr = await metaError(res); if (res.status < 500) break; continue; }
        const data = await res.json();
        const raw = String(data?.choices?.[0]?.message?.content || '').trim();
        const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        let parsed; try { parsed = JSON.parse(text); } catch { const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b <= a) throw new Error('Meta returned non-JSON'); parsed = JSON.parse(text.slice(a, b + 1)); }
        return { ok: true, provider: this.name, model: this.model, parsed, latencyMs: Date.now() - started, validated: true };
      } catch (e) { lastErr = e?.name === 'AbortError' ? new Error(`Meta API timed out after ${this.timeoutMs}ms`) : e; if (e?.name === 'AbortError') break; // never retry a timed-out generation
      } finally { if (timer) clearTimeout(timer); }
    }
    throw lastErr || new Error('Meta API failed');
  }
  /** Free-form chat over the compiled context. Returns plain text only;
   * it can explain and suggest, never mutate (enforced by callers). */
  async chat(messages) {
    if (!this.configured) throw new Error('MODEL_API_KEY not configured');
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) { // one retry, transient failures only
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST', ...(ctrl ? { signal: ctrl.signal } : {}),
          headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, temperature: 0.3, messages }),
        });
        if (!res.ok) { lastErr = await metaError(res); if (res.status < 500) break; continue; }
        const data = await res.json();
        const text = String(data?.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error('Meta returned an empty chat response');
        return text.slice(0, 2000);
      } catch (e) { lastErr = e?.name === 'AbortError' ? new Error(`Meta API timed out after ${this.timeoutMs}ms`) : e; if (e?.name === 'AbortError' || /empty chat/.test(lastErr.message)) break; }
      finally { if (timer) clearTimeout(timer); }
    }
    throw lastErr || new Error('Meta API failed');
  }
}
export function createProvider(env = process.env) {
  return env.MODEL_API_KEY ? new MetaReasoningProvider({}) : new DeterministicProvider();
}
