import { touchConnection } from './canonical.js';
// Canonical calendar events behind the CalendarProvider contract.
// Deterministic importance/movability first; a model may enrich later.
export const IMPORTANCE_KEYWORDS = ['investor', 'board', 'interview', 'deadline', 'review', 'client', 'exam', 'presentation'];
export function classifyEvent(raw) {
  const title = String(raw.title || ''); const lower = title.toLowerCase();
  const attendees = Array.isArray(raw.attendees) ? raw.attendees.length : Number(raw.attendee_count || 0);
  let importance = raw.importance || null;
  if (!importance) importance = (IMPORTANCE_KEYWORDS.some(k => lower.includes(k)) || attendees >= 4) ? 'critical' : (attendees > 0 || Number(raw.durationMin || raw.duration_minutes || 0) >= 90) ? 'high' : 'medium';
  const movability = raw.movability || raw.movability_hint || ((importance === 'critical' || /flight|train|appointment/.test(lower)) ? 'fixed' : 'unknown');
  return { importance, movability };
}
export function normalizeCalendarEvent(input, { provider = 'local' } = {}) {
  if (!input?.title || !input?.starts_at) throw new Error('calendar event requires title and starts_at');
  const start = new Date(input.starts_at); if (Number.isNaN(start.getTime())) throw new Error('calendar event starts_at is invalid');
  const dur = Number(input.duration_minutes || input.durationMin || 30);
  const end = input.ends_at ? new Date(input.ends_at) : new Date(start.getTime() + dur * 60000);
  const base = { title: String(input.title).slice(0, 200), starts_at: start.toISOString(), ends_at: end.toISOString(), duration_minutes: Math.round((end - start) / 60000), all_day: Boolean(input.all_day), attendee_count: Array.isArray(input.attendees) ? input.attendees.length : Number(input.attendee_count || 0) };
  const { importance, movability } = classifyEvent({ ...base, importance: input.importance, movability: input.movability });
  return { provider_event_id: input.provider_event_id ? String(input.provider_event_id) : null, provider, ...base, importance, priority: importance, movability, status: input.status || 'confirmed', last_synced_at: new Date().toISOString() };
}
export function ingestCalendarBatch(state, events, { provider = 'local' } = {}) {
  state.canonical ||= { healthSignals: [], calendarEvents: [], workouts: [], checkins: [] };
  const store = state.canonical.calendarEvents; let accepted = 0, updated = 0;
  for (const raw of events) { const e = normalizeCalendarEvent(raw, { provider }); const i = e.provider_event_id ? store.findIndex(x => x.provider === e.provider && x.provider_event_id === e.provider_event_id) : -1;
    if (i >= 0) { store[i] = { ...store[i], ...e }; updated++; } else { store.push({ id: `cal_${store.length + 1}_${Math.random().toString(36).slice(2, 7)}`, ...e }); accepted++; } }
  store.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  touchConnection(state, provider, 'calendar');
  return { accepted, updated, total: store.length };
}
