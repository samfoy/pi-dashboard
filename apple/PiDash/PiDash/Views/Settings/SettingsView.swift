import SwiftUI

// MARK: - SettingsView

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @Environment(ThemeManager.self) private var themeManager
    @State private var urlText: String = ""
    @State private var tokenText: String = ""
    @State private var cwdText: String = ""
    @State private var testResult: String?
    @State private var isTesting = false
    @State private var isFetchingToken = false
    @State private var tokenFetchError: String?
    @State private var slotCwds: [String] = []
    @State private var showDefaultModelPicker = false
    @State private var showLogs = false
    @AppStorage("appearanceMode") private var appearanceMode: Int = 0

    private func setAppearanceMode(_ mode: Int) {
        appearanceMode = mode
    }

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

                Section(header: Text("Server"), footer: Text("Auth token is at ~/.pi/dashboard-token on the server. The share extension reads from the same stored value.")) {
                    TextField("Server URL", text: $urlText)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit { saveURL() }
                    SecureField("Auth Token", text: $tokenText)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.system(.body, design: .monospaced))
                        .onSubmit { saveToken() }
                    Button {
                        Task { await fetchTokenFromServer() }
                    } label: {
                        HStack {
                            if isFetchingToken {
                                ProgressView().scaleEffect(0.8)
                            } else {
                                Image(systemName: "arrow.down.circle")
                            }
                            Text("Fetch token from server")
                        }
                    }
                    .disabled(isFetchingToken)
                    if let err = tokenFetchError {
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
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

                Section("New Chat Defaults") {
                    // Default model
                    Button {
                        showDefaultModelPicker = true
                    } label: {
                        HStack {
                            Text("Default Model")
                                .foregroundStyle(.primary)
                            Spacer()
                            if appState.serverConfig.defaultModel.isEmpty {
                                Text("None")
                                    .foregroundStyle(.secondary)
                            } else {
                                Text(shortModelLabel(appState.serverConfig.defaultModel))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)

                    // Default thinking level
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Default Thinking Level")
                        Picker("", selection: Binding(
                            get: {
                                appState.serverConfig.defaultThinkingLevel.isEmpty
                                    ? "none"
                                    : appState.serverConfig.defaultThinkingLevel
                            },
                            set: { newLevel in
                                appState.updateDefaultThinkingLevel(newLevel == "none" ? "" : newLevel)
                            }
                        )) {
                            Text("None").tag("none")
                            ForEach(ChatViewModel.thinkingLevels, id: \.self) { level in
                                Text(level).tag(level)
                            }
                        }
                        .pickerStyle(.segmented)
                    }

                    Text("Applied automatically when creating a new chat slot.")
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
                    Button {
                        showLogs = true
                    } label: {
                        HStack {
                            Label("Debug Logs", systemImage: "doc.text.magnifyingglass")
                            Spacer()
                            if !Log.entries.isEmpty {
                                Text("\(Log.entries.count)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                    Button("Save") { saveURL(); saveToken(); saveCwd(); dismiss() }
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
            .sheet(isPresented: $showLogs) { LogView() }
            .sheet(isPresented: $showDefaultModelPicker) {
                DefaultModelPickerSheet { model in
                    if let model {
                        appState.updateDefaultModel("\(model.provider)/\(model.modelId)")
                    } else {
                        appState.updateDefaultModel("")
                    }
                }
            }
            .onAppear {
                urlText = appState.serverConfig.baseURL
                tokenText = appState.serverConfig.token
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

    private func fetchTokenFromServer() async {
        isFetchingToken = true
        tokenFetchError = nil
        let serverBase = urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? appState.serverConfig.baseURL
            : urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: "\(serverBase)/connection-info") else {
            tokenFetchError = "Invalid server URL"
            isFetchingToken = false
            return
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                tokenFetchError = "Server returned \(http.statusCode)"
                isFetchingToken = false
                return
            }
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let token = json["token"] as? String, !token.isEmpty {
                tokenText = token
                saveToken()
                tokenFetchError = nil
            } else {
                tokenFetchError = "No token in response"
            }
        } catch {
            tokenFetchError = error.localizedDescription
        }
        isFetchingToken = false
    }

    private func saveURL() {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        appState.updateServerConfig(baseURL: trimmed)
    }

    private func saveToken() {
        let trimmed = tokenText.trimmingCharacters(in: .whitespacesAndNewlines)
        appState.updateServerConfig(token: trimmed)
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

    /// Short display label for a stored "provider/modelId" string (no model list needed)
    private func shortModelLabel(_ stored: String) -> String {
        guard stored.contains("/") else { return stored }
        return String(stored.split(separator: "/", maxSplits: 1).last ?? Substring(stored))
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

// MARK: - DefaultModelPickerSheet

private struct DefaultModelPickerSheet: View {
    let onSelect: (ModelInfo?) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @Environment(AppState.self) private var appState
    @State private var models: [ModelInfo] = []
    @State private var loadError: String? = nil
    @State private var isLoading = false
    @State private var searchText = ""

    private var currentModelString: String { appState.serverConfig.defaultModel }

    private var filteredModels: [ModelInfo] {
        if searchText.isEmpty { return models }
        let q = searchText.lowercased()
        return models.filter {
            $0.label.lowercased().contains(q) ||
            $0.provider.lowercased().contains(q) ||
            $0.modelId.lowercased().contains(q)
        }
    }

    private var groupedModels: [(provider: String, models: [ModelInfo])] {
        let grouped = Dictionary(grouping: filteredModels) { $0.provider }
        return grouped.sorted { $0.key < $1.key }.map { (provider: $0.key, models: $0.value) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading models…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let err = loadError {
                    ContentUnavailableView {
                        Label("Failed to Load", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(err)
                    } actions: {
                        Button("Retry") { Task { await load() } }
                    }
                } else if models.isEmpty {
                    ContentUnavailableView {
                        Label("No Models", systemImage: "cpu")
                    }
                } else {
                    List {
                        Section {
                            Button {
                                onSelect(nil)
                                dismiss()
                            } label: {
                                HStack {
                                    Text("None (server default)")
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if currentModelString.isEmpty {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(theme.accent)
                                    }
                                }
                            }
                        }
                        ForEach(groupedModels, id: \.provider) { section in
                            Section(section.provider) {
                                ForEach(section.models, id: \.fullId) { model in
                                    let modelKey = model.fullId
                                    Button {
                                        onSelect(model)
                                        dismiss()
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(model.label)
                                                    .foregroundStyle(.primary)
                                                Text(model.modelId)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                            Spacer()
                                            if currentModelString == modelKey {
                                                Image(systemName: "checkmark")
                                                    .foregroundStyle(theme.accent)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search models")
            .navigationTitle("Default Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        do {
            let all = try await appState.apiClient.fetchModels()
            let piSettings = try? await appState.apiClient.fetchPiSettings()
            // Exclude geographic-prefix duplicates (eu.*, global.*)
            let filtered = all.filter { m in
                let id = m.id.lowercased()
                return !id.hasPrefix("eu.") && !id.hasPrefix("global.")
            }
            models = ModelInfo.sorted(filtered, enabledModels: piSettings?.enabledModels ?? [])
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}
