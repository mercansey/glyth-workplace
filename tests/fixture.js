// Test-only fixture: the baseline day used to exercise the engine.
// This data lives in tests, never in the shipped application state.
import * as E from '../src/domain/engine.js';
export function createFixtureState() {
  const s = E.createSeedState();
  s.baselines = { sleepMinutes: 435, recovery: 72, energy: 74, trainingSessionsPerWeek: 4 };
  s.goals = [
    { id: 'g_strength', name: 'Improve strength', category: 'Health', priority: 1, target: '4 sessions / week', status: 'active', progress: 68 },
    { id: 'g_work', name: 'Protect work performance', category: 'Work', priority: 1, target: '2 protected focus blocks / day', status: 'active', progress: 74 },
    { id: 'g_recovery', name: 'Improve recovery consistency', category: 'Health', priority: 2, target: 'Recovery >= 65 on 5 days / week', status: 'active', progress: 52 },
  ];
  s.routines = { wake: '06:30', training: '07:30', deepWork: '10:00', admin: '17:00' };
  s.currentState = { sleepMinutes: 435, sleepQuality: 78, recovery: 72, energy: 74, workload: 55, trainingLoad: 45, stress: 38, consecutivePoorNights: 0, readiness: 74 };
  s.signals = [
    { id: 'sig_sleep', type: 'sleep', value: 435, baseline: 435, source: 'fixture', kind: 'observed', at: 'today 06:30' },
    { id: 'sig_recovery', type: 'recovery', value: 72, baseline: 72, source: 'fixture', kind: 'observed', at: 'today 06:30' },
  ];
  s.plan = [
    { id: 'p_train', time: '07:30', title: 'Heavy strength session', type: 'training', priority: 'high', durationMin: 60, status: 'unchanged', note: 'Week 6, lower body' },
    { id: 'p_focus', time: '10:00', title: 'Deep work', type: 'work', priority: 'high', durationMin: 120, status: 'unchanged', note: 'Investor deck draft' },
    { id: 'p_lunch', time: '12:30', title: 'Lunch', type: 'meal', priority: 'medium', durationMin: 45, status: 'unchanged', note: '' },
    { id: 'p_meeting', time: '14:00', title: 'Investor meeting', type: 'meeting', priority: 'critical', durationMin: 60, status: 'unchanged', note: 'High-value. Do not move.' },
    { id: 'p_admin', time: '17:00', title: 'Admin', type: 'admin', priority: 'low', durationMin: 45, status: 'unchanged', note: 'Email, expenses, scheduling' },
  ];
  s.focusPriorities = ['Train with intent', 'Protect deep work', 'Prepare for investor meeting'];
  s.interventions = [{ id: 'int_1', title: 'Protected focus after late night', outcome: 'Completed before meeting', at: 'Last Thursday', kind: 'heuristic' }];
  return s;
}
