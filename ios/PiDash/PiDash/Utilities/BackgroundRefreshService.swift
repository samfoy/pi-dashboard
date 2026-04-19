import Foundation
import BackgroundTasks
import UserNotifications

// MARK: - BackgroundRefreshService

/// Polls the server via BGTaskScheduler when the app is backgrounded.
/// Fires local notifications for completed chats or input-needed events.
enum BackgroundRefreshService {
    static let taskIdentifier = "com.pidash.refresh"
    
    /// Last known slot states — used to detect changes.
    private static let lastPollKey = "lastPollTimestamp"
    private static let knownCompletedKey = "knownCompletedSlots"
    
    // MARK: - Registration
    
    /// Call once at app launch (before scene appears).
    static func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            handleRefresh(task: task)
        }
    }
    
    /// Schedule the next background refresh.
    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60) // At least 1 min from now
        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BGRefresh] Scheduled next refresh")
        } catch {
            print("[BGRefresh] Schedule failed: \(error)")
        }
    }
    
    // MARK: - Poll Handler
    
    private static func handleRefresh(task: BGAppRefreshTask) {
        // Schedule the next one immediately
        scheduleRefresh()
        
        let pollTask = Task {
            await poll()
        }
        
        task.expirationHandler = {
            pollTask.cancel()
        }
        
        Task {
            await pollTask.value
            task.setTaskCompleted(success: true)
        }
    }
    
    /// Poll the server and fire notifications for changes.
    static func poll() async {
        guard let baseURL = UserDefaults.standard.string(forKey: "serverBaseURL")
                ?? Optional("http://samuels-macbook-air-1.taile86245.ts.net:7777") else { return }
        
        guard let url = URL(string: "\(baseURL)/api/poll") else { return }
        
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
            
            let result = try JSONDecoder().decode(PollResponse.self, from: data)
            
            // Check which slots completed since last poll
            let knownCompleted = Set(UserDefaults.standard.stringArray(forKey: knownCompletedKey) ?? [])
            var nowCompleted = Set<String>()
            
            for slot in result.slots {
                let isComplete = !(slot.running ?? false)
                if isComplete {
                    nowCompleted.insert(slot.key)
                    
                    // If this slot was running last time and is now done, notify
                    if !knownCompleted.contains(slot.key) {
                        await fireNotification(
                            id: "bg-done-\(slot.key)",
                            title: slot.title ?? "Chat",
                            body: "Response complete",
                            threadId: slot.key
                        )
                    }
                }
            }
            
            // Notify for unacked notifications from server
            for notif in result.notifications {
                await fireNotification(
                    id: "bg-notif-\(notif.ts ?? UUID().uuidString)",
                    title: notif.title ?? "Pi",
                    body: notif.body ?? "Needs your attention",
                    threadId: notif.slot,
                    timeSensitive: true
                )
            }
            
            // Update known state
            UserDefaults.standard.set(Array(nowCompleted), forKey: knownCompletedKey)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastPollKey)
            
        } catch {
            print("[BGRefresh] Poll failed: \(error)")
        }
    }
    
    // MARK: - Notification Helper
    
    private static func fireNotification(
        id: String,
        title: String,
        body: String,
        threadId: String?,
        timeSensitive: Bool = false
    ) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let threadId { content.threadIdentifier = threadId }
        if timeSensitive { content.interruptionLevel = .timeSensitive }
        
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

// MARK: - Poll Response Models

private struct PollResponse: Decodable {
    let slots: [PollSlot]
    let notifications: [PollNotification]
}

private struct PollSlot: Decodable {
    let key: String
    let title: String?
    let running: Bool?
    let updatedAt: String?
    
    enum CodingKeys: String, CodingKey {
        case key, title, running
        case updatedAt = "updated_at"
    }
}

private struct PollNotification: Decodable {
    let title: String?
    let body: String?
    let slot: String?
    let ts: String?
}
