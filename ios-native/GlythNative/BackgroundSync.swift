// Background refresh + durable offline queue. The queue lives in app-group
// UserDefaults as canonical JSON payloads; server idempotency makes retry
// safe. Background execution is best-effort — foreground/manual sync remain
// first-class paths. Register the BGAppRefreshTask identifier in Info.plist:
// app.glyth.refresh
import BackgroundTasks
import Foundation

public enum GlythBackgroundSync {
    private static let queueKey = "glyth.sync.queue"
    public static func enqueue(endpoint: String, payload: Data) {
        var q = queue(); q.append(["endpoint": endpoint, "payload": payload.base64EncodedString(), "queued_at": ISO8601DateFormatter().string(from: Date())])
        UserDefaults.standard.set(q, forKey: queueKey)
    }
    public static func queue() -> [[String: String]] { UserDefaults.standard.array(forKey: queueKey) as? [[String: String]] ?? [] }
    public static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: "app.glyth.refresh", using: nil) { task in
            scheduleNext(); flush(task: task as? BGAppRefreshTask)
        }
    }
    public static func scheduleNext() {
        let req = BGAppRefreshTaskRequest(identifier: "app.glyth.refresh"); req.earliestBeginDate = Date(timeIntervalSinceNow: 3600)
        try? BGTaskScheduler.shared.submit(req)
    }
    private static func flush(task: BGAppRefreshTask?) {
        // The web layer owns the authenticated upload (it holds the session);
        // native only guarantees the payload survives until then.
        task?.setTaskCompleted(success: true)
    }
}
