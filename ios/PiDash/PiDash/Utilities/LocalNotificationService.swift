import Foundation
import UserNotifications

// MARK: - LocalNotificationService

/// Manages local notifications for chat events when the app is backgrounded or on another screen.
@Observable
final class LocalNotificationService: NSObject, UNUserNotificationCenterDelegate {
    private(set) var isAuthorized = false
    
    /// Slot key currently being viewed — suppress notifications for this slot.
    var activeSlotKey: String?

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show notification banners even when the app is in the foreground.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    /// Handle notification tap — navigate to the relevant chat.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let slotKey = response.notification.request.content.threadIdentifier
        guard !slotKey.isEmpty else { return }
        await MainActor.run {
            onNotificationTap?(slotKey)
        }
    }

    /// Callback set by AppState to handle navigation on notification tap.
    var onNotificationTap: ((String) -> Void)?

    func requestPermission() async {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            await MainActor.run { isAuthorized = granted }
        } catch {
            print("[Notifications] Permission error: \(error)")
        }
    }
    
    func checkPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        await MainActor.run { isAuthorized = settings.authorizationStatus == .authorized }
    }
    
    // MARK: - Chat Notifications
    
    /// Notify when an assistant message completes (chat_done).
    func notifyChatDone(slotKey: String, title: String) {
        guard isAuthorized, slotKey != activeSlotKey else { return }
        
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = "Response complete"
        content.sound = .default
        content.threadIdentifier = slotKey
        content.categoryIdentifier = "chat_done"
        
        let request = UNNotificationRequest(
            identifier: "chat-done-\(slotKey)-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil  // Deliver immediately
        )
        UNUserNotificationCenter.current().add(request)
    }
    
    /// Notify when pi needs user input (approval, follow-up).
    func notifyInputNeeded(slotKey: String, title: String, body: String?) {
        guard isAuthorized, slotKey != activeSlotKey else { return }
        
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body ?? "Pi needs your input"
        content.sound = .default
        content.threadIdentifier = slotKey
        content.categoryIdentifier = "input_needed"
        content.interruptionLevel = .timeSensitive
        
        let request = UNNotificationRequest(
            identifier: "input-\(slotKey)-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
    
    /// Notify for a new assistant message (only when app is backgrounded).
    func notifyNewMessage(slotKey: String, title: String, preview: String) {
        guard isAuthorized, slotKey != activeSlotKey else { return }
        
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = String(preview.prefix(200))
        content.sound = nil  // Silent for message chunks
        content.threadIdentifier = slotKey
        content.categoryIdentifier = "chat_message"
        
        let request = UNNotificationRequest(
            identifier: "msg-\(slotKey)",  // Same ID = replaces previous for this slot
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
    
    /// Clear notifications for a specific slot (when user opens the chat).
    func clearNotifications(forSlot slotKey: String) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { notifications in
            let ids = notifications
                .filter { $0.request.content.threadIdentifier == slotKey }
                .map { $0.request.identifier }
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }
    
    /// Clear badge count.
    func clearBadge() {
        UNUserNotificationCenter.current().setBadgeCount(0) { _ in }
    }
}
