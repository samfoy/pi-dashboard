import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            WebView()
                .ignoresSafeArea(.container, edges: .bottom)

            if appState.connectionFailed {
                ConnectionFailedOverlay()
            }
        }
        .onAppear {
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
            Text("Check your server URL in Settings.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                appState.connectionFailed = false
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(32)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
    }
}
