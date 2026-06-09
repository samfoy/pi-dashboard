import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            WebView()
                .ignoresSafeArea(.container, edges: .bottom)
                .onLongPressGesture(minimumDuration: 1.5) {
                    appState.showSettings = true
                }

            if appState.connectionFailed {
                ConnectionFailedOverlay()
            }
        }
        .sheet(isPresented: Binding(
            get: { appState.showSettings },
            set: { appState.showSettings = $0 }
        )) {
            SettingsView()
                .environment(appState)
        }
        .onChange(of: appState.connectionFailed) {
            if appState.connectionFailed && appState.serverConfig.baseURL.isEmpty {
                appState.showSettings = true
            }
        }
        .onAppear {
            if appState.serverConfig.baseURL.isEmpty {
                appState.showSettings = true
            }
            Task { await appState.notificationService.requestPermission() }
        }
    }
}

// MARK: - Connection Failed Overlay

private struct ConnectionFailedOverlay: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Can't connect to Pi")
                .font(.headline)
            Text("Check your server URL and make sure the dashboard is running.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 12) {
                Button("Settings") {
                    appState.showSettings = true
                }
                .buttonStyle(.bordered)
                Button("Retry") {
                    appState.connectionFailed = false
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(32)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal, 32)
    }
}
