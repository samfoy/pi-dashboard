import SwiftUI

// MARK: - SettingsView

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var urlText: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Server URL", text: $urlText)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit { saveURL() }
                }

                Section("Connection") {
                    HStack {
                        Text("Status")
                        Spacer()
                        ConnectionIndicator()
                    }
                }

                Section {
                    Button("Save") { saveURL(); dismiss() }
                        .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                urlText = appState.serverConfig.baseURL
            }
        }
    }

    private func saveURL() {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        appState.updateServerConfig(baseURL: trimmed)
    }
}

// MARK: - ConnectionIndicator

private struct ConnectionIndicator: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor)
                .frame(width: 8, height: 8)
            Text(appState.connectionState.displayText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var dotColor: Color {
        switch appState.connectionState {
        case .connected: return .green
        case .connecting, .reconnecting: return .orange
        case .disconnected, .failed: return .red
        }
    }
}
