// Workload & stress are DERIVED. Documented deterministic method:
// meetingDensity = meeting minutes / 480-min work window * 100.
// focusFragmentation = share of the work window not in >=90-min free blocks, 0-100.
// A one-tap check-in (Low/Normal/High) blends 50/50 with the calendar score.
// Terminology is workload/schedule pressure, never clinical stress.
export function deriveWorkload(events = [], checkin = null, windowMinutes = 480) {
  const meetings = (events || []).filter(e => e.status !== 'cancelled' && !e.all_day);
  const meetingMinutes = meetings.reduce((a, e) => a + (e.duration_minutes || 0), 0);
  const meetingDensity = Math.max(0, Math.min(100, Math.round(meetingMinutes / windowMinutes * 100)));
  const sorted = [...meetings].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  let freeLong = 0, cursor = null;
  for (const e of sorted) { const s = new Date(e.starts_at); if (cursor && (s - cursor) >= 90 * 60000) freeLong += (s - cursor) / 60000; cursor = new Date(Math.max(cursor || 0, new Date(e.ends_at))); }
  const fragmentation = Math.max(0, Math.min(100, 100 - Math.round(freeLong / windowMinutes * 100)));
  const calendarScore = Math.round(meetingDensity * 0.6 + fragmentation * 0.4);
  const checkinValue = checkin ? { low: 25, normal: 55, high: 85 }[checkin.workload] ?? null : null;
  return { meetingDensity, focusFragmentation: fragmentation, workload: checkinValue == null ? calendarScore : Math.round(calendarScore * 0.5 + checkinValue * 0.5), checkin: checkin || null, method: 'meeting_density_60_focus_fragmentation_40' };
}
export function normalizeCheckin(input, at = new Date().toISOString()) {
  const level = (k) => { const v = String(input?.[k] || '').toLowerCase(); if (!['low', 'normal', 'high'].includes(v)) throw new Error(`check-in ${k} must be low|normal|high`); return v; };
  return { at, energy: level('energy'), workload: level('workload'), stress: level('stress'), stressLabel: 'subjective stress (self-report, not clinical)' };
}
