// CalendarProvider interface + LocalCalendarProvider. GoogleCalendarProvider
// is a future plug-in behind this same interface (stretch, not built).
export class LocalCalendarProvider {
  constructor(state) { this.state = state; }
  listEvents() { return this.state.plan; }
  proposeMove(item, patch) { return { item, patch, requiresConfirmation: true }; }
  updateEvent(id, patch) { const i = this.state.plan.find(p => p.id === id); if (i) Object.assign(i, patch); return i; }
  createEvent(event) { this.state.plan.push(event); return event; }
}
