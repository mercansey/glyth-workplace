// Glyth native bridge contracts — SCAFFOLD ONLY.
// There is no iOS target in this repository yet; this file defines the
// contract a future native target must implement. It is not compiled here.
// See docs/APPLE_NATIVE_BRIDGE.md for the full strategy.

import Foundation

protocol HealthDataProvider {
    func authorizationStatus() async -> String
    func requestAuthorization() async throws
    func syncSleep() async throws       // HKAnchoredObjectQuery, anchor persisted on device
    func syncRecovery() async throws
    func syncVitals() async throws      // HRV + resting heart rate only
    func syncWorkouts() async throws
}

protocol GlythCalendarProvider {
    func authorizationStatus() async -> String
    func listEvents(range: DateInterval) async throws -> [CanonicalCalendarEvent]
    func syncEvents(range: DateInterval) async throws -> [CanonicalCalendarEvent]
}

struct CanonicalCalendarEvent: Codable {
    var provider_event_id: String
    var title: String
    var starts_at: String   // ISO-8601
    var ends_at: String
    var attendee_count: Int
    var all_day: Bool
}
