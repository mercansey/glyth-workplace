// Canonical data layer: ONE flow source -> adapter -> normalisation ->
// canonical store (on the user state) -> derived state. No provider schema
// leaks past this file; no missing metric is ever invented (null stays null).
export const PRIVACY_CLASS = {
  sleep: 'PRIVATE_HEALTH', sleep_minutes: 'PRIVATE_HEALTH', recovery: 'PRIVATE_HEALTH', energy: 'PRIVATE_HEALTH',
  hrv: 'PRIVATE_HEALTH', resting_heart_rate: 'PRIVATE_HEALTH', workouts: 'PRIVATE_HEALTH', training_load: 'PRIVATE_HEALTH',
  goals: 'PRIVATE_PERSONAL', routines: 'PRIVATE_PERSONAL', plan: 'PRIVATE_PERSONAL', calendar: 'PRIVATE_PERSONAL',
  conversation: 'PRIVATE_CONVERSATION',
  workload: 'WORK_PATTERN_CONSENTABLE', meeting_density: 'WORK_PATTERN_CONSENTABLE', focus_fragmentation: 'WORK_PATTERN_CONSENTABLE',
  engagement: 'WORK_PATTERN_CONSENTABLE', capacity: 'WORK_PATTERN_CONSENTABLE', schedule_density: 'WORK_PATTERN_CONSENTABLE',
  directory: 'ORGANISATION_CONTENT',
};
export const privacyClassOf = (k) => PRIVACY_CLASS[k] || 'PRIVATE_PERSONAL';
export const HEALTH_PROVIDERS = ['apple_healthkit', 'oura', 'whoop', 'android_health', 'manual'];
export const DEFAULT_SLEEP_THRESHOLD_MIN = 390; // 6h30, used only until a personal baseline exists

export function localDate(iso, timezone = 'Europe/London') {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return String(iso).slice(0, 10); }
}
/** A sleep session belongs to the waking day: the local date it ENDS. */
export function nightDateFor(periodStart, periodEnd, timezone) { return localDate(periodEnd || periodStart, timezone); }

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export function normalizeHealthSample(input, { provider, timezone = 'Europe/London' } = {}) {
  if (!input || typeof input !== 'object') throw new Error('health sample must be an object');
  const type = String(input.signal_type || input.type || '');
  if (!['sleep', 'recovery', 'energy', 'hrv', 'resting_heart_rate', 'training_load'].includes(type)) throw new Error(`unsupported signal_type "${type}"`);
  if (provider && !HEALTH_PROVIDERS.includes(provider)) throw new Error(`unsupported health provider "${provider}"`);
  const observed = input.observed_at || input.period_end || input.at;
  if (!observed || Number.isNaN(Date.parse(observed))) throw new Error('health sample requires a valid observed_at/period_end');
  return {
    signal_type: type, value: num(input.value), unit: input.unit || (type === 'sleep' ? 'minutes' : type === 'hrv' ? 'ms' : type === 'resting_heart_rate' ? 'bpm' : 'score'),
    observed_at: new Date(observed).toISOString(),
    period_start: input.period_start ? new Date(input.period_start).toISOString() : null,
    period_end: input.period_end ? new Date(input.period_end).toISOString() : new Date(observed).toISOString(),
    night_date: type === 'sleep' ? nightDateFor(input.period_start, input.period_end || observed, timezone) : localDate(observed, timezone),
    source_provider: provider || input.source_provider || 'manual',
    source_external_id: input.source_external_id ? String(input.source_external_id) : null,
    source_metric: input.source_metric || type, confidence: num(input.confidence),
    quality: type === 'sleep' ? num(input.quality ?? input.sleep_quality) : undefined,
  };
}

/** Idempotent batch ingest: provider+external_id (or type+period) is the key. */
export function ingestHealthBatch(state, samples, { provider = 'manual', deletedExternalIds = [] } = {}) {
  state.canonical ||= { healthSignals: [], calendarEvents: [], workouts: [], checkins: [] };
  const store = state.canonical.healthSignals;
  const keyOf = (s) => s.source_external_id ? `${s.source_provider}:${s.source_external_id}` : `${s.source_provider}:${s.signal_type}:${s.period_start || ''}:${s.period_end || ''}`;
  let accepted = 0, updated = 0, deleted = 0;
  for (const raw of samples) {
    const s = normalizeHealthSample(raw, { provider, timezone: state.profile.timezone });
    const k = keyOf(s); const i = store.findIndex(x => keyOf(x) === k);
    if (i >= 0) { store[i] = s; updated++; } else { store.push(s); accepted++; }
  }
  for (const id of deletedExternalIds) { const i = store.findIndex(x => x.source_external_id === String(id) && x.source_provider === provider); if (i >= 0) { store.splice(i, 1); deleted++; } }
  store.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  touchConnection(state, provider, 'health');
  return { accepted, updated, deleted, total: store.length };
}

export function touchConnection(state, provider, kind) {
  state.connections ||= [];
  const id = `${kind}:${provider}`; const now = new Date().toISOString();
  const c = state.connections.find(x => x.id === id);
  if (c) Object.assign(c, { status: 'connected', last_sync_at: now, last_success_at: now, last_error: null });
  else state.connections.push({ id, provider, kind, status: 'connected', last_sync_at: now, last_success_at: now, last_error: null });
}

/** Derive one day's state (and today's currentState) from canonical sleep/recovery signals. */
export function deriveDailyState(state, date = localDate(new Date().toISOString(), state.profile.timezone)) {
  const sig = (state.canonical?.healthSignals || []);
  const sleep = sig.filter(s => s.signal_type === 'sleep' && s.night_date === date).sort((a, b) => a.period_end.localeCompare(b.period_end)).at(-1);
  const on = (type) => sig.filter(s => s.signal_type === type && s.night_date === date).sort((a, b) => a.observed_at.localeCompare(b.observed_at)).at(-1)?.value ?? null;
  const baseline = state.baselines?.sleepMinutes ?? null;
  const threshold = baseline ?? DEFAULT_SLEEP_THRESHOLD_MIN;
  const shortNight = sleep ? sleep.value < (baseline ? baseline * 0.9 : threshold) : null;
  const record = { date, sleepMinutes: sleep?.value ?? null, sleepQuality: sleep?.quality ?? null, recovery: on('recovery'), energy: on('energy'), hrv: on('hrv'), restingHeartRate: on('resting_heart_rate'),
    shortNight, baselineSource: sleep ? (baseline ? 'PERSONAL_BASELINE' : 'DEFAULT_THRESHOLD') : null };
  state.dailyHistory ||= [];
  const i = state.dailyHistory.findIndex(d => d.date === date);
  if (record.sleepMinutes != null || record.recovery != null) { if (i >= 0) state.dailyHistory[i] = record; else state.dailyHistory.push(record); state.dailyHistory.sort((a, b) => a.date.localeCompare(b.date)); }
  // consecutive short nights ending on this date, from completed nightly records
  let streak = 0; const days = state.dailyHistory.filter(d => d.date <= date).sort((a, b) => b.date.localeCompare(a.date));
  for (const d of days) { if (d.shortNight) streak++; else if (d.sleepMinutes != null) break; }
  record.consecutiveShortNights = sleep ? streak : null;
  if (date === localDate(new Date().toISOString(), state.profile.timezone) || !state.currentState?.sleepMinutes) {
    if (sleep) Object.assign(state.currentState, { sleepMinutes: sleep.value, sleepQuality: sleep.quality ?? state.currentState.sleepQuality, consecutivePoorNights: streak });
    if (record.recovery != null) state.currentState.recovery = record.recovery;
    if (record.energy != null) state.currentState.energy = record.energy;
  }
  // keep the engine-facing legacy signal list as a thin projection (not a second source of truth)
  state.signals = sig.slice(-12).map((s, i) => ({ id: `canon_${i}`, type: s.signal_type, value: s.value, baseline: null, source: s.source_provider, kind: 'observed', at: s.observed_at }));
  return record;
}
