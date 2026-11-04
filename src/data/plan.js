// DailyPlanAssembler: deterministic merge. Fixed commitments first and never
// moved; then training, protected focus, routine/meal blocks; flexible items
// shift by 30-minute steps to resolve collisions. No LLM layout.
import { localDate } from './canonical.js';
const mins = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const hm = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
export function assembleDailyPlan(state, date = localDate(new Date().toISOString(), state.profile.timezone), { focusMinutes = 120 } = {}) {
  const events = (state.canonical?.calendarEvents || []).filter(e => localDate(e.starts_at, state.profile.timezone) === date && e.status !== 'cancelled');
  const items = [];
  const overlaps = (s, e) => items.some(i => s < i._end && e > i._start);
  const place = (item, flexible) => {
    let s = item._start, e = s + item.durationMin;
    if (flexible) { let guard = 0; while (overlaps(s, e) && guard++ < 32) { s += 30; e += 30; } if (overlaps(s, e)) return null; }
    item._start = s; item._end = e; item.time = hm(s); items.push(item); return item;
  };
  for (const e of events.sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    place({ id: `plan_${e.id || e.provider_event_id || items.length}`, _start: mins(e.starts_at), durationMin: e.duration_minutes, title: e.title, type: e.importance === 'critical' ? 'meeting' : 'calendar', priority: e.importance, status: 'unchanged', note: e.movability === 'fixed' ? 'Fixed commitment.' : '', source: 'calendar', movability: e.movability }, e.movability !== 'fixed');
  }
  const planned = (state.canonical?.workouts || []).find(w => w.planned && localDate(w.started_at, state.profile.timezone) === date);
  if (planned) place({ id: 'p_train', _start: mins(planned.started_at), durationMin: planned.duration_minutes, title: planned.intensity === 'high' || planned.intensity === 'max' ? 'Heavy strength session' : 'Training session', type: 'training', priority: 'high', status: 'unchanged', note: 'Planned session', source: 'training', movability: 'flexible' }, true);
  else if (state.plan.some(p => p.type === 'training')) items.push(...[]);
  if (!items.some(i => /deep work|focus/i.test(i.title))) place({ id: 'p_focus', _start: 10 * 60, durationMin: focusMinutes, title: 'Deep work', type: 'work', priority: 'high', status: 'unchanged', note: 'Protected focus block', source: 'assembler', movability: 'flexible' }, true);
  place({ id: 'p_lunch', _start: 12 * 60 + 30, durationMin: 45, title: 'Lunch', type: 'meal', priority: 'medium', status: 'unchanged', note: '', source: 'routine', movability: 'flexible' }, true);
  if (!items.some(i => i.type === 'meeting' && i.priority === 'critical')) { /* no invented commitments */ }
  const adminTime = state.routines?.admin || '17:00'; const [ah, am] = String(adminTime).split(':').map(Number);
  if (state.goals.length || state.plan.some(p => p.type === 'admin')) place({ id: 'p_admin', _start: ah * 60 + (am || 0), durationMin: 45, title: 'Admin', type: 'admin', priority: 'low', status: 'unchanged', note: '', source: 'routine', movability: 'flexible' }, true);
  items.sort((a, b) => a._start - b._start);
  state.plan = items.map(({ _start, _end, ...rest }) => rest);
  state.planAssembledAt = new Date().toISOString();
  return state.plan;
}
