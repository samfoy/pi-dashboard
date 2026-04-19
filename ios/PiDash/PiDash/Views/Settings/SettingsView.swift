import SwiftUI

// MARK: - SettingsView

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @Environment(ThemeManager.self) private var themeManager
    @State private var urlText: String = ""
    @State private var cwdText: String = ""
    @State private var testResult: String?
    @State private var isTesting = false
    @State private var slotCwds: [String] = []

    var body: some View {
        NavigationStack {
            Form {
                Section("Theme") {
                    ForEach(AppTheme.allPresets, id: \.name) { preset in
                        Button {
                            themeManager.select(preset)
                        } label: {
                            HStack(spacing: 12) {
                                HStack(spacing: 4) {
                                    Circle()
                                        .fill(preset.accent)
                                        .frame(width: 14, height: 14)
                                    Circle()
                                        .fill(preset.cardBg)
                                        .overlay(Circle().stroke(preset.border, lineWidth: 0.5))
                                        .frame(width: 14, height: 14)
                                    Circle()
                                        .fill(preset.text)
                                        .frame(width: 14, height: 14)
                                }
                                Text(preset.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                if theme.name == preset.name {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(theme.accent)
                                        .font(.caption.bold())
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                Section("Appearance") {
                    Picker("Color Scheme", selection: Binding(
                        get: { appearanceMode },
                        set: { setAppearanceMode($0) }
                    )) {
                        Text("System").tag(0)
                        Text("Light").tag(1)
                        Text("Dark").tag(2)
                    }
                    .pickerStyle(.segmented)
                }

                Section("Server") {
                    TextField("Server URL", text: $urlText)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit { saveURL() }
                }

                Section("Working Directory") {
                    TextField("Default cwd (e.g. ~/Projects/myapp)", text: $cwdText)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.system(.body, design: .monospaced))
                        .onSubmit { saveCwd() }

                    if !slotCwds.isEmpty {
                        ForEach(slotCwds, id: \.self) { path in
                            Button {
                                cwdText = path
                                saveCwd()
                            } label: {
                                HStack {
                                    Image(systemName: "folder")
                                        .foregroundStyle(.secondary)
                                    Text(path)
                                        .font(.system(.subheadline, design: .monospaced))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    Spacer()
                                    if path == appState.serverConfig.defaultCwd {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(theme.accent)
                                            .font(.caption)
                                    }
                                }
                            }
                        }
                    }

                    Text("Sets the working directory for new chats. Pi will pick up AGENTS.md and project context from this path.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Connection") {
                    HStack {
                        Text("Status")
                        Spacer()
                        ConnectionIndicator()
                    }

                    Button {
                        Task { await testConnection() }
                    } label: {
                        HStack {
                            Text("Test Connection")
                            Spacer()
                            if isTesting {
                                ProgressView().controlSize(.small)
                            }
                        }
                    }
                    .disabled(isTesting)

                    if let result = testResult {
                        Text(result)
                            .font(.caption)
                            .foregroundStyle(result.hasPrefix("✓") ? theme.success : theme.error)
                    }

                    Button("Reconnect WebSocket") {
                        appState.wsManager.connect()
                    }
                }

                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(appVersion)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button("Save") { saveURL(); saveCwd(); dismiss() }
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
                cwdText = appState.serverConfig.defaultCwd
                testResult = nil
                // Collect unique cwds from existing slots
                slotCwds = Array(Set(appState.slots.compactMap { slot in
                    // Extract cwd from slot — check the API response
                    nil as String?  // Populated below from API
                })).sorted()
                Task { await loadSlotCwds() }
            }
        }
    }

    private func saveURL() {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        appState.updateServerConfig(baseURL: trimmed)
    }

    private func saveCwd() {
        let trimmed = cwdText.trimmingCharacters(in: .whitespacesAndNewlines)
        appState.updateDefaultCwd(trimmed)
    }

    private func loadSlotCwds() async {
        // Fetch slot list to get cwds
        do {
            let data = try await appState.apiClient.fetchRaw(path: "/chat/slots")
            struct CwdSlot: Decodable { let cwd: String? }
            let slots = try JSONDecoder().decode([CwdSlot].self, from: data)
            let cwds = Set(slots.compactMap { $0.cwd }).filter { !$0.isEmpty }
            await MainActor.run { slotCwds = cwds.sorted() }
        } catch {
            // Silently ignore — not critical
        }
    }

    private func testConnection() async {
        isTesting = true
        testResult = nil
        do {
            let msg = try await appState.apiClient.fetchStatus()
            testResult = "✓ \(msg)"
        } catch {
            testResult = "✗ \(error.localizedDescription)"
        }
        isTesting = false
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
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
                .animation(.easeInOut(duration: 0.3), value: appState.connectionState.isConnected)
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
