import SwiftUI

@main
struct PiDashApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            SlotListView()
                .environment(appState)
                .task {
                    appState.start()
                }
        }
    }
}
