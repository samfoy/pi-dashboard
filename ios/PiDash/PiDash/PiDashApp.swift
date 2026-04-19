import SwiftUI

@main
struct PiDashApp: App {
    @State private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        BackgroundRefreshService.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .task {
                    appState.start()
                }
                .onChange(of: scenePhase) {
                    switch scenePhase {
                    case .active:
                        appState.wsManager.connect()
                        appState.notificationService.clearBadge()
                        Task { await appState.notificationService.checkPermission() }
                    case .background:
                        BackgroundRefreshService.scheduleRefresh()
                    default:
                        break
                    }
                }
                .onOpenURL { url in
                    // Handle deep links from widgets: pidash://slot/<key> or pidash://new-chat
                    guard url.scheme == "pidash" else { return }
                    if url.host == "slot", let key = url.pathComponents.dropFirst().first, !key.isEmpty {
                        appState.pendingDeepLinkKey = key
                    }
                    // pidash://new-chat — no-op here; SlotListView shows new-chat UI by default
                }
        }
    }
}
