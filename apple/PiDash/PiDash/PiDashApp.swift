import SwiftUI
import UserNotifications

@main
struct PiDashApp: App {
    @State private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        BackgroundRefreshService.register()
        registerNotificationCategories()
    }

    private func registerNotificationCategories() {
        let stopAction = UNNotificationAction(
            identifier: "stop_action",
            title: "Stop",
            options: [.destructive]
        )
        let approveAction = UNNotificationAction(
            identifier: "approve_action",
            title: "Approve",
            options: [.foreground]
        )
        let rejectAction = UNNotificationAction(
            identifier: "reject_action",
            title: "Reject",
            options: [.destructive]
        )
        let chatDoneCategory = UNNotificationCategory(
            identifier: "chat_done",
            actions: [stopAction],
            intentIdentifiers: [],
            options: []
        )
        let inputNeededCategory = UNNotificationCategory(
            identifier: "input_needed",
            actions: [approveAction, rejectAction],
            intentIdentifiers: [],
            options: []
        )
        let chatMessageCategory = UNNotificationCategory(
            identifier: "chat_message",
            actions: [],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([
            chatDoneCategory,
            inputNeededCategory,
            chatMessageCategory,
        ])
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .onChange(of: scenePhase) {
                    switch scenePhase {
                    case .active:
                        appState.connectionFailed = false
                        appState.notificationService.clearBadge()
                        Task { await appState.notificationService.checkPermission() }
                    case .background:
                        BackgroundRefreshService.scheduleRefresh()
                    default:
                        break
                    }
                }
                .onOpenURL { url in
                    guard url.scheme == "pidash" else { return }
                    if url.host == "slot", let key = url.pathComponents.dropFirst().first, !key.isEmpty {
                        appState.pendingDeepLinkKey = key
                    }
                }
        }
    }
}
