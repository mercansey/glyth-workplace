// Training: deterministic load, cross-provider reconciliation (no double count).
export const SOURCE_PRIORITY = { whoop: 3, oura: 2, apple_healthkit: 1, manual: 0 };
export function normalizeWorkout(input, { provider = 'manual' } = {}) {
  if (!input?.started_at) throw new Error('workout requires started_at');
  const start = new Date(input.started_at); if (Number.isNaN(start.getTime())) throw new Error('workout started_at is invalid');
  const duration = Number(input.duration_minutes || input.durationMin || 0); if (!(duration > 0)) throw new Error('workout requires duration_minutes');
  const intensity = String(input.intensity || 'moderate'); if (!['low', 'moderate', 'high', 'max'].includes(intensity)) throw new Error(`invalid intensity "${intensity}"`);
  const loadFactor = { low: 0.5, moderate: 1, high: 1.6, max: 2.2 }[intensity];
  return { external_id: input.external_id ? String(input.external_id) : null, provider, started_at: start.toISOString(), duration_minutes: duration, intensity, type: input.type || 'training', planned: Boolean(input.planned),
    load: Math.round(duration * loadFactor), source_metric: 'duration_x_intensity' };
}
export function ingestWorkouts(state, workouts, { provider = 'manual' } = {}) {
  state.canonical ||= { healthSignals: [], calendarEvents: [], workouts: [], checkins: [] };
  const store = state.canonical.workouts; let accepted = 0, reconciled = 0;
  for (const raw of workouts) { const w = normalizeWorkout(raw, { provider });
    const same = store.find(x => Math.abs(new Date(x.started_at) - new Date(w.started_at)) < 15 * 60000 && Math.abs(x.duration_minutes - w.duration_minutes) <= 10);
    if (same) { if ((SOURCE_PRIORITY[w.provider] ?? 0) > (SOURCE_PRIORITY[same.provider] ?? 0)) Object.assign(same, w); reconciled++; continue; }
    const i = w.external_id ? store.findIndex(x => x.provider === w.provider && x.external_id === w.external_id) : -1;
    if (i >= 0) store[i] = w; else store.push(w); accepted++;
  }
  store.sort((a, b) => a.started_at.localeCompare(b.started_at)); return { accepted, reconciled, total: store.length };
}
export function trainingSummary(state, now = new Date()) {
  const w = state.canonical?.workouts || []; const day = (d) => d.toISOString().slice(0, 10); const today = day(now);
  const yday = day(new Date(now.getTime() - 86400000));
  const sum = (pred) => w.filter(pred).reduce((a, x) => a + x.load, 0);
  const yesterdayLoad = sum(x => x.started_at.slice(0, 10) === yday && !x.planned);
  const recentLoad = sum(x => (now - new Date(x.started_at)) < 7 * 86400000 && !x.planned);
  const plannedToday = w.find(x => x.planned && x.started_at.slice(0, 10) === today) || null;
  // scale: a hard 60-min session ~= 96 load; >=80 reads as high recent load (engine rule scale 0-100)
  return { yesterdayLoad, recentLoad, recentLoadScore: Math.max(0, Math.min(100, Math.max(yesterdayLoad, Math.round(recentLoad / 3)))), highRecentLoad: yesterdayLoad >= 80 || recentLoad >= 240, plannedToday };
}
