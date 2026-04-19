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
            SlotListView()
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
        }
    }
}
