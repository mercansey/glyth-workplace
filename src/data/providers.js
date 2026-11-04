// Provider contracts. Today/Web components consume canonical data only.
// Apple HealthKit/EventKit are device-mediated: there is NO native target in
// this repository, so the Apple adapters are an explicit unavailable scaffold
// (contract in native/ios/ProviderContracts.swift +
// docs/APPLE_NATIVE_BRIDGE.md). They never fake access from the web.
export class HealthDataProvider {
  async authorizationStatus() { return 'not_requested'; }
  async requestAuthorization() { throw new Error('not implemented by this provider'); }
  async syncSleep() { throw new Error('not implemented by this provider'); }
  async syncRecovery() { throw new Error('not implemented by this provider'); }
  async syncVitals() { throw new Error('not implemented by this provider'); }
  async syncWorkouts() { throw new Error('not implemented by this provider'); }
}
export class AppleHealthKitWebScaffold extends HealthDataProvider {
  async authorizationStatus() { return 'unavailable_web'; } // native client required; see docs/APPLE_NATIVE_BRIDGE.md
  async requestAuthorization() { throw new Error('HealthKit requires the native iOS client; web cannot request HealthKit access'); }
  async syncSleep() { throw new Error('HealthKit sync happens on device and posts to /api/ingest/health'); }
}
export class ManualHealthProvider extends HealthDataProvider {
  async authorizationStatus() { return 'authorized'; } // user-entered data, no external permission
}
export class CalendarProviderContract {
  async authorizationStatus() { return 'not_requested'; }
  async listEvents(_range) { return []; }
  async syncEvents(_range) { return []; }
  async createEvent() { throw new Error('not implemented by this provider'); }
  async updateEvent() { throw new Error('not implemented by this provider'); }
}
export class LocalCalendarProvider extends CalendarProviderContract {
  constructor(state) { super(); this.state = state; }
  async authorizationStatus() { return 'authorized'; }
  async listEvents() { return this.state.canonical?.calendarEvents || []; }
  async syncEvents() { return this.listEvents(); }
}
export class TrainingProviderContract {
  async authorizationStatus() { return 'not_requested'; }
  async syncWorkouts() { return []; }
  async plannedSessions() { return []; }
}
