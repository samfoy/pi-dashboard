import Foundation
import Observation

// MARK: - NotificationAction

enum NotificationAction {
    case navigateToSlot(String)
    case stopSlot(String)
    case approveSlot(String)
    case rejectSlot(String)
}

// MARK: - AppState

@MainActor @Observable
final class AppState {
    let serverConfig = ServerConfig()
    let notificationService = LocalNotificationService()
    var pendingDeepLinkKey: String?
    var pendingNotificationAction: NotificationAction?
    var connectionFailed: Bool = false
}
