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
    var serverConfig = ServerConfig()
    let notificationService = LocalNotificationService()

    init() {
        notificationService.onNotificationTap = { [weak self] key in
            self?.pendingDeepLinkKey = key
        }
        notificationService.onNotificationAction = { [weak self] action in
            self?.pendingNotificationAction = action
        }
    }
    var pendingDeepLinkKey: String?
    var pendingNotificationAction: NotificationAction?
    var connectionFailed: Bool = false
    var showSettings: Bool = false
}
