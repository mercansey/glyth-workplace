// Baselines are DERIVED, never provider data. Median over a 28-day window,
// minimum 7 valid days, otherwise null. Outlier-resistant by construction.
export function computeBaseline(values, { windowDays = 28, minSamples = 7 } = {}) {
  const clean = (values || []).filter(v => v != null && Number.isFinite(v)).slice(-windowDays);
  if (clean.length < minSamples) return { value: null, sampleCount: clean.length, windowDays, minSamples, ready: false };
  const sorted = [...clean].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { value: median, sampleCount: clean.length, windowDays, minSamples, ready: true };
}
export function recalculateBaselines(state, now = new Date()) {
  const hist = (state.dailyHistory || []).filter(d => d.date <= now.toISOString().slice(0, 10));
  const pick = (k) => hist.map(d => d[k]);
  const meta = {
    sleep: computeBaseline(pick('sleepMinutes')), recovery: computeBaseline(pick('recovery')), energy: computeBaseline(pick('energy')),
    calculated_at: now.toISOString(), windowDays: 28, minSamples: 7,
  };
  state.baselineMeta = meta;
  state.baselines = { ...(state.baselines || {}), sleepMinutes: meta.sleep.value, recovery: meta.recovery.value, energy: meta.energy.value };
  return meta;
}
