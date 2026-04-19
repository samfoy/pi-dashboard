import SwiftUI

@main
struct PiDashApp: App {
    @State private var appState = AppState()
    @State private var themeManager = ThemeManager()
    @Environment(\.scenePhase) private var scenePhase

    @AppStorage("appearanceMode") private var appearanceMode: Int = 0

    private var colorScheme: ColorScheme? {
        switch appearanceMode {
        case 1: return .light
        case 2: return .dark
        default: return nil
        }
    }

    init() {
        BackgroundRefreshService.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(themeManager)
                .environment(\.appTheme, themeManager.current)
                .preferredColorScheme(colorScheme)
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
