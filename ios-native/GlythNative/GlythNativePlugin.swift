// GlythNative — local Capacitor plugin (Swift). Real HealthKit/EventKit/
// Keychain implementation for the iOS App target. Add this folder to the
// App target; register in the Capacitor plugin list. Nothing here is used
// on web, and no backend secret ever reaches this code — it receives a
// short-lived user session token from the web layer at sync time.
import Capacitor
import UIKit
import HealthKit
import EventKit
import Security
import Foundation
import AVFoundation

@objc(GlythNativePlugin)
public class GlythNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlythNativePlugin"
    public let jsName = "GlythNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthAuthorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthRequestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthSyncSleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthSyncRecovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthSyncWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarAuthorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarRequestFullAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarRequestWriteOnlyAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendarSyncEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureRemove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speechSpeak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speechStop", returnType: CAPPluginReturnPromise),
    ]
    private let health = HKHealthStore()
    private let synthesizer = AVSpeechSynthesizer()
    // MARK: Mindfulness fallback speech (AVSpeechSynthesizer). Used only when
    // no generated audio exists; never presented as generated media.
    @objc func speechSpeak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("text required"); return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = min(0.55, max(0.35, Float(call.getDouble("rate") ?? 0.92) * 0.5)) // calm, measured pace
        utterance.pitchMultiplier = 0.95
        synthesizer.speak(utterance)
        call.resolve(["speaking": true])
    }
    @objc func speechStop(_ call: CAPPluginCall) { synthesizer.stopSpeaking(at: .immediate); call.resolve(["speaking": false]) }
    private let events = EKEventStore()

    @objc func capabilities(_ call: CAPPluginCall) {
        call.resolve(["healthKit": HKHealthStore.isHealthDataAvailable(), "calendar": true, "push": true,
                      "backgroundRefresh": UIApplication.shared.backgroundRefreshStatus == .available])
    }

    // MARK: HealthKit — only the types the canonical pipeline uses
    private var readTypes: Set<HKObjectType> {
        var s: Set<HKObjectType> = [HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
                                    HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!,
                                    HKObjectType.quantityType(forIdentifier: .restingHeartRate)!,
                                    HKObjectType.workoutType()]
        return s
    }
    @objc func healthAuthorizationStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["status": "unavailable"]); return }
        // HealthKit does not reveal read-permission status; report request state honestly.
        call.resolve(["status": "not_requested_or_unknown"])
    }
    @objc func healthRequestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("HealthKit unavailable on this device"); return }
        health.requestAuthorization(toShare: [], read: readTypes) { ok, err in
            if let err { call.reject(err.localizedDescription) } else { call.resolve(["requested": ok]) }
        }
    }
    private func anchorKey(_ name: String) -> String { "glyth.hk.anchor.\(name)" }
    private func loadAnchor(_ name: String) -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: anchorKey(name)),
              let a = try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data) else { return nil }
        return a
    }
    private func saveAnchor(_ name: String, _ anchor: HKQueryAnchor?) {
        if let anchor, let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) { UserDefaults.standard.set(data, forKey: anchorKey(name)) }
    }
    /// Anchored incremental sync. Returns canonical samples for the web layer
    /// to POST to /api/ingest/health (server deduplicates). Deleted samples
    /// are returned as external IDs for server reconciliation.
    private func anchoredSync(type: HKSampleType, name: String, call: CAPPluginCall, map: @escaping (HKSample) -> [String: Any]?) {
        let q = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: loadAnchor(name), limit: HKObjectQueryNoLimit) { [weak self] _, samples, deleted, newAnchor, err in
            if let err { call.reject(err.localizedDescription); return }
            self?.saveAnchor(name, newAnchor)
            call.resolve(["samples": (samples ?? []).compactMap(map), "deleted_external_ids": (deleted ?? []).map { $0.uuid.uuidString }])
        }
        health.execute(q)
        // Observer + background delivery for future wakeups (optimisation, not a guarantee)
        let oq = HKObserverQuery(sampleType: type, predicate: nil) { _, done, _ in done() }
        health.execute(oq)
        health.enableBackgroundDelivery(for: type, frequency: .daily) { _, _ in }
    }
    @objc func healthSyncSleep(_ call: CAPPluginCall) {
        anchoredSync(type: HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!, name: "sleep", call: call) { s in
            guard let c = s as? HKCategorySample else { return nil }
            let minutes = (s.endDate.timeIntervalSince(s.startDate)) / 60.0
            let asleep = c.value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue || c.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue || c.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue || c.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
            guard asleep, minutes > 20 else { return nil }
            return ["signal_type": "sleep", "value": minutes, "source_external_id": s.uuid.uuidString,
                    "period_start": ISO8601DateFormatter().string(from: s.startDate), "period_end": ISO8601DateFormatter().string(from: s.endDate)]
        }
    }
    private func anchoredSamples(type: HKSampleType, name: String, map: @escaping (HKSample) -> [String: Any]?, done: @escaping ([[String: Any]], [String]) -> Void) {
        let q = HKAnchoredObjectQuery(type: type, predicate: nil, anchor: loadAnchor(name), limit: HKObjectQueryNoLimit) { [weak self] _, samples, deleted, newAnchor, _ in
            self?.saveAnchor(name, newAnchor); done((samples ?? []).compactMap(map), (deleted ?? []).map { $0.uuid.uuidString })
        }
        health.execute(q)
    }
    @objc func healthSyncRecovery(_ call: CAPPluginCall) {
        // Raw HRV + resting heart rate with provenance. No invented recovery score.
        anchoredSamples(type: HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!, name: "hrv", map: { s in
            guard let q = s as? HKQuantitySample else { return nil }
            return ["signal_type": "hrv", "value": q.quantity.doubleValue(for: HKUnit.secondUnit(with: .milli)), "source_metric": "hrv_sdnn",
                    "source_external_id": s.uuid.uuidString, "period_start": ISO8601DateFormatter().string(from: s.startDate), "period_end": ISO8601DateFormatter().string(from: s.endDate)]
        }) { [weak self] hrv, del1 in
            self?.anchoredSamples(type: HKObjectType.quantityType(forIdentifier: .restingHeartRate)!, name: "rhr", map: { s in
                guard let q = s as? HKQuantitySample else { return nil }
                return ["signal_type": "resting_heart_rate", "value": q.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute())), "source_metric": "resting_heart_rate",
                        "source_external_id": s.uuid.uuidString, "period_start": ISO8601DateFormatter().string(from: s.startDate), "period_end": ISO8601DateFormatter().string(from: s.endDate)]
            }) { rhr, del2 in call.resolve(["samples": hrv + rhr, "deleted_external_ids": del1 + del2]) }
        }
    }
    @objc func healthSyncWorkouts(_ call: CAPPluginCall) {
        anchoredSync(type: HKObjectType.workoutType(), name: "workouts", call: call) { s in
            guard let w = s as? HKWorkout else { return nil }
            return ["started_at": ISO8601DateFormatter().string(from: w.startDate), "duration_minutes": w.endDate.timeIntervalSince(w.startDate) / 60.0,
                    "intensity": "moderate", "type": "workout", "external_id": w.uuid.uuidString]
        }
    }

    // MARK: EventKit (current iOS 17+ access APIs)
    @objc func calendarAuthorizationStatus(_ call: CAPPluginCall) {
        call.resolve(["status": "\(EKEventStore.authorizationStatus(for: .event))"])
    }
    @objc func calendarRequestFullAccess(_ call: CAPPluginCall) {
        events.requestFullAccessToEvents { ok, err in if let err { call.reject(err.localizedDescription) } else { call.resolve(["granted": ok]) } }
    }
    @objc func calendarRequestWriteOnlyAccess(_ call: CAPPluginCall) {
        events.requestWriteOnlyAccessToEvents { ok, err in if let err { call.reject(err.localizedDescription) } else { call.resolve(["granted": ok]) } }
    }
    @objc func calendarSyncEvents(_ call: CAPPluginCall) {
        let days = call.getInt("days") ?? 14
        let start = Calendar.current.startOfDay(for: Date()); let end = Calendar.current.date(byAdding: .day, value: days, to: start)!
        let pred = events.predicateForEvents(withStart: start, end: end, calendars: nil)
        let out = events.events(matching: pred).map { e in
            ["provider_event_id": e.eventIdentifier ?? "", "title": e.title ?? "", "starts_at": ISO8601DateFormatter().string(from: e.startDate),
             "ends_at": ISO8601DateFormatter().string(from: e.endDate), "all_day": e.isAllDay, "attendee_count": e.attendees?.count ?? 0] as [String: Any]
        }
        call.resolve(["events": out])
    }

    // MARK: Keychain secure storage (never UserDefaults/localStorage for tokens)
    private func keychainQuery(_ key: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.glyth.secure", kSecAttrAccount as String: key] }
    @objc func secureSet(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else { call.reject("key/value required"); return }
        var q = keychainQuery(key); SecItemDelete(q as CFDictionary); q[kSecValueData as String] = Data(value.utf8)
        let status = SecItemAdd(q as CFDictionary, nil); status == errSecSuccess ? call.resolve() : call.reject("keychain write \(status)")
    }
    @objc func secureGet(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key required"); return }
        var q = keychainQuery(key); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecSuccess, let data = out as? Data { call.resolve(["value": String(data: data, encoding: .utf8) ?? ""]) } else { call.resolve(["value": ""]) }
    }
    @objc func secureRemove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key required"); return }
        SecItemDelete(keychainQuery(key) as CFDictionary); call.resolve()
    }
}
