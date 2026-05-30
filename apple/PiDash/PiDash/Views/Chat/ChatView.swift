import SwiftUI
import MarkdownUI

// MARK: - ChatView

struct ChatView: View {
    let slot: ChatSlot
    var scrollToMessageId: UUID? = nil
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewModel: ChatViewModel?
    @State private var showCwdPicker = false

    var body: some View {
        Group {
            if let vm = viewModel {
                ChatContentView(viewModel: vm, scrollToMessageId: scrollToMessageId)
            } else {
                ProgressView()
            }
        }
        .task {
            guard viewModel == nil else { return }
            let vm = ChatViewModel(
                slot: slot,
                apiClient: appState.apiClient,
                appState: appState
            )
            viewModel = vm
            appState.registerChatViewModel(vm, for: slot.key)
            // Load data in an unstructured Task so SwiftUI re-renders
            // (triggered by setting viewModel above) can't cancel the fetch.
            Task {
                await vm.loadHistory()
                await vm.loadModels()
                await vm.loadSlashCommands()
                await vm.refreshGitSummary()
            }
        }
        .onDisappear {
            appState.unregisterChatViewModel(for: slot.key)
        }
        .onAppear {
            appState.clearNotification(forSlot: slot.key)
            // Refresh messages when returning to chat (catches messages from other clients)
            if let vm = viewModel, !vm.isLoadingHistory {
                Task { await vm.loadHistory() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, let vm = viewModel, !vm.isLoadingHistory {
                Task { await vm.loadHistory() }
            }
        }
        .navigationTitle(viewModel?.slot.title ?? slot.title)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showCwdPicker) {
            if let vm = viewModel {
                ProjectPickerSheet(
                    slots: appState.slots,
                    apiClient: appState.apiClient
                ) { newCwd in
                    Task {
                        try? await appState.apiClient.setCwd(slotKey: vm.slot.key, cwd: newCwd)
                        // Update local slot cwd
                        if let i = appState.slots.firstIndex(where: { $0.key == vm.slot.key }) {
                            appState.slots[i].cwd = newCwd
                        }
                        vm.slot.cwd = newCwd
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(viewModel?.slot.title ?? slot.title)
                        .font(.headline)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        if let cwd = viewModel?.slot.cwd ?? slot.cwd {
                            Button {
                                showCwdPicker = true
                            } label: {
                                HStack(spacing: 3) {
                                    Image(systemName: "folder.fill")
                                        .font(.caption2)
                                    Text((cwd as NSString).lastPathComponent.isEmpty ? cwd : (cwd as NSString).lastPathComponent)
                                        .font(.caption2)
                                        .lineLimit(1)
                                }
                                .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        } else if let modelName = viewModel?.currentModel?.name ?? viewModel?.slot.model {
                            Text(modelName)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if let git = viewModel?.gitSummary, git.isRepo, let branch = git.branch {
                            GitBranchPill(branch: branch, dirty: git.dirtyFiles ?? 0)
                        }
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if let vm = viewModel {
                    ChatSettingsMenu(viewModel: vm)
                }
            }
        }
    }
}

// MARK: - ChatContentView

private struct ChatContentView: View {
    @Bindable var viewModel: ChatViewModel
    let scrollToMessageId: UUID?
    @State private var isAtBottom = true
    @State private var showCommandPalette = false
    @State private var showTagEditor = false
    @State private var showModelPickerFromToolbar = false
    @State private var showForkPickerFromBubble = false
    @State private var isUploadingFiles = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppState.self) private var appState
    @Environment(\.appTheme) private var theme
    private let healthService = HealthKitService.shared
    private let calendarService = CalendarService.shared
    private let remindersService = RemindersService.shared
    private let contactsService = ContactsService.shared
    private let locationService = LocationService.shared
    private let speechService = SpeechService.shared
    @State private var isSpeechRecording = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(spacing: 0) {
                // Error banner
                if let error = viewModel.error {
                    HStack {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.white)
                            .lineLimit(3)
                        Spacer()
                        Button("Dismiss") { viewModel.error = nil }
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(theme.error)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                // Context usage bar — shown when approaching context limit
                if let pct = viewModel.slot.contextPercent, pct > 0.5 {
                    ContextUsageBar(percent: pct)
                        .transition(.opacity)
                }

                // Session cost bar — shown when we have token stats
                if let stats = viewModel.tokenStats, stats.totalTokens > 0 {
                    SessionCostBar(stats: stats)
                        .transition(.opacity)
                }

                messageList

                ChatInputBar(
                    text: $viewModel.inputText,
                    pendingImages: $viewModel.pendingImages,
                    isStreaming: viewModel.isStreaming,
                    isDisabled: viewModel.isLoadingHistory,
                    contextPercent: viewModel.slot.contextPercent,
                    heartbeatStallMs: viewModel.heartbeatStallMs,
                    lastAssistantContent: viewModel.messages.last(where: { $0.role == .assistant })?.content,
                    onShowPalette: { showCommandPalette = true },
                    onShowModelPicker: { showModelPickerFromToolbar = true },
                    onCompact: { Task { await viewModel.sendCommand("compact") } },
                    onHealthSummary: {
                        Task {
                            try? await healthService.requestAuthorization()
                            let summary = await healthService.fetchTodaySummary()
                            await MainActor.run {
                                viewModel.inputText = summary + viewModel.inputText
                            }
                        }
                    },
                    onCalendarSummary: {
                        Task {
                            try? await calendarService.requestAuthorization()
                            let summary = await calendarService.fetchUpcomingEvents()
                            await MainActor.run {
                                viewModel.inputText = summary + "\n" + viewModel.inputText
                            }
                        }
                    },
                    onRemindersSummary: {
                        Task {
                            try? await remindersService.requestAuthorization()
                            let summary = await remindersService.fetchIncompleteReminders()
                            await MainActor.run {
                                viewModel.inputText = summary + "\n" + viewModel.inputText
                            }
                        }
                    },
                    onContactsSummary: {
                        Task {
                            try? await contactsService.requestAuthorization()
                            let summary = await contactsService.fetchContacts()
                            await MainActor.run {
                                viewModel.inputText = summary + "\n" + viewModel.inputText
                            }
                        }
                    },
                    onLocationSummary: {
                        Task {
                            await locationService.requestAuthorization()
                            let summary = await locationService.fetchLocationSummary()
                            await MainActor.run {
                                viewModel.inputText = summary + "\n" + viewModel.inputText
                            }
                        }
                    },
                    onSpeechTap: {
                        if isSpeechRecording {
                            speechService.stopRecording()
                            isSpeechRecording = false
                        } else {
                            Task {
                                await speechService.requestAuthorization()
                                speechService.startRecording { text in
                                    Task { @MainActor in
                                        viewModel.inputText = text
                                        isSpeechRecording = false
                                    }
                                }
                                await MainActor.run { isSpeechRecording = true }
                            }
                        }
                    },
                    isSpeechRecording: isSpeechRecording,
                    onUploadFileURLs: { urls in
                        guard !urls.isEmpty else { return }
                        Task { await uploadFiles(urls) }
                    },
                    onDocumentPickFiles: { items in
                        guard !items.isEmpty else { return }
                        Task { await uploadDocumentItems(items) }
                    },
                    isUploadingFiles: isUploadingFiles,
                    onSend: { Task { await viewModel.send() } },
                    onStop: { Task { await viewModel.stop() } }
                )
                .sheet(isPresented: $showCommandPalette) {
                    CommandPaletteSheet(
                        commands: viewModel.slashCommands,
                        onSelect: { cmd in Task { await viewModel.sendCommand(cmd.name) } },
                        viewModel: viewModel,
                        onTagsTapped: { showTagEditor = true }
                    )
                }
                .sheet(isPresented: $showTagEditor) {
                    TagEditorSheet(
                        slot: viewModel.slot,
                        apiClient: appState.apiClient
                    ) { newTags in
                        if let i = appState.slots.firstIndex(where: { $0.key == viewModel.slot.key }) {
                            appState.slots[i].tags = newTags
                        }
                        TagEditorSheet.recordTags(newTags)
                    }
                }
                .sheet(isPresented: $showModelPickerFromToolbar) {
                    ModelPickerSheet(viewModel: viewModel)
                }
                .sheet(isPresented: $showForkPickerFromBubble) {
                    ForkPickerSheet(slotKey: viewModel.slotKey)
                }
            }

            // Jump-to-bottom FAB
            if !isAtBottom {
                Button {
                    isAtBottom = true
                } label: {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.title)
                        .foregroundStyle(theme.accent)
                        .background(Circle().fill(theme.pageBg))
                        .shadow(radius: 4)
                }
                .padding(.trailing, 16)
                .padding(.bottom, 80)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? .none : .spring(duration: 0.3), value: isAtBottom)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if viewModel.isLoadingHistory {
                        ProgressView()
                            .padding()
                    }
                    if viewModel.messages.isEmpty && !viewModel.isLoadingHistory {
                        ChatEmptyStateView { prompt in
                            viewModel.inputText = prompt
                            Task { await viewModel.send() }
                        }
                        .padding(.top, 40)
                    }
                    ForEach(viewModel.messages) { message in
                        MessageBubble(
                            message: message,
                            onFork: message.role == .user ? { showForkPickerFromBubble = true } : nil
                        )
                            .id(message.id)
                    }
                    // Invisible anchor at bottom — onAppear/onDisappear tracks if user is at bottom
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                        .onAppear { isAtBottom = true }
                        .onDisappear { isAtBottom = false }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                scrollToBottom(proxy: proxy, animated: false)
            }
            // Auto-scroll when new messages arrive
            .onChange(of: viewModel.messages.count) { _, _ in
                if isAtBottom {
                    scrollToBottom(proxy: proxy, animated: true)
                }
            }
            // Auto-scroll during streaming chunks
            .onChange(of: viewModel.messages.last?.content) { _, _ in
                if isAtBottom {
                    scrollToBottom(proxy: proxy, animated: false)
                }
            }
            // Handle FAB tap
            .onChange(of: isAtBottom) { _, newValue in
                if newValue {
                    scrollToBottom(proxy: proxy, animated: true)
                }
            }
            // Scroll to search target after history loads
            .onChange(of: viewModel.isLoadingHistory) { _, isLoading in
                if !isLoading, let targetId = scrollToMessageId {
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 200_000_000)
                        withAnimation(.easeOut(duration: 0.3)) {
                            proxy.scrollTo(targetId, anchor: .center)
                        }
                    }
                }
            }
            // Real bottom detection via sentinel onAppear/onDisappear (iOS 17 compatible)
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        if animated && !reduceMotion {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo("bottom", anchor: .top)
            }
        } else {
            withAnimation(.none) {
                proxy.scrollTo("bottom", anchor: .top)
            }
        }
    }

    /// Upload picked files to the server, then inject the returned paths into
    /// the message input as a markdown attachment note.
    private func uploadFiles(_ urls: [URL]) async {
        isUploadingFiles = true
        defer { isUploadingFiles = false }

        var items: [UploadFileItem] = []
        for url in urls {
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let item = UploadFileItem(
                name: url.lastPathComponent,
                data: data.base64EncodedString()
            )
            items.append(item)
        }
        guard !items.isEmpty else {
            viewModel.error = "Couldn't read selected files"
            HapticManager.error()
            return
        }

        do {
            let paths = try await appState.apiClient.uploadFiles(items)
            guard !paths.isEmpty else { return }
            let attachmentNote = paths.map { "Attached: `\($0)`" }.joined(separator: "\n")
            let current = viewModel.inputText
            if current.isEmpty {
                viewModel.inputText = attachmentNote
            } else {
                let sep = current.hasSuffix("\n") ? "\n" : "\n\n"
                viewModel.inputText = current + sep + attachmentNote
            }
            HapticManager.messageSent()
        } catch {
            viewModel.error = "Upload failed: \(error.localizedDescription)"
            HapticManager.error()
        }
    }

    /// Upload files picked by DocumentPicker (data already read within security scope).
    private func uploadDocumentItems(_ fileItems: [(name: String, data: Data)]) async {
        isUploadingFiles = true
        defer { isUploadingFiles = false }
        let items = fileItems.map { UploadFileItem(name: $0.name, data: $0.data.base64EncodedString()) }
        do {
            let paths = try await appState.apiClient.uploadFiles(items)
            guard !paths.isEmpty else { return }
            let attachmentNote = paths.map { "Attached: `\($0)`" }.joined(separator: "\n")
            let current = viewModel.inputText
            viewModel.inputText = current.isEmpty ? attachmentNote : current + (current.hasSuffix("\n") ? "\n" : "\n\n") + attachmentNote
            HapticManager.messageSent()
        } catch {
            viewModel.error = "Upload failed: \(error.localizedDescription)"
            HapticManager.error()
        }
    }
}

// MARK: - Chat Settings Menu (Model & Thinking)

private struct ChatSettingsMenu: View {
    @Bindable var viewModel: ChatViewModel
    @Environment(AppState.self) private var appState
    @State private var showModelPicker = false
    @State private var showThinkingPicker = false
    @State private var showRename = false
    @State private var renameText = ""
    @State private var showSystemPrompt = false
    @State private var showForkPicker = false
    @State private var showSubagentDock = false
    @State private var isGeneratingTitle = false

    var body: some View {
        Menu {
            // Rename
            Button {
                renameText = viewModel.slot.title
                showRename = true
            } label: {
                Label("Rename", systemImage: "pencil")
            }

            // Auto-title
            Button {
                guard !isGeneratingTitle else { return }
                isGeneratingTitle = true
                Task {
                    await viewModel.autoTitle()
                    isGeneratingTitle = false
                }
            } label: {
                Label("Generate title", systemImage: "sparkles")
            }
            .disabled(isGeneratingTitle)

            // View system prompt
            Button {
                showSystemPrompt = true
            } label: {
                Label("View system prompt", systemImage: "doc.text.magnifyingglass")
            }

            // Fork conversation
            Button {
                showForkPicker = true
            } label: {
                Label("Fork from\u{2026}", systemImage: "arrow.triangle.branch")
            }

            // Subagents dock
            Button {
                showSubagentDock = true
            } label: {
                Label("Subagents", systemImage: "person.2.crop.square.stack")
            }

            // Current model display
            Section("Model") {
                Button {
                    showModelPicker = true
                } label: {
                    Label(
                        viewModel.currentModel?.label ?? "Default",
                        systemImage: "cpu"
                    )
                }
            }

            // Thinking level
            Section("Thinking") {
                ForEach(ChatViewModel.thinkingLevels, id: \.self) { level in
                    Button {
                        Task { await viewModel.setThinking(level) }
                    } label: {
                        HStack {
                            Text(level.capitalized)
                            if viewModel.thinkingLevel == level {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.body)
        }
        .sheet(isPresented: $showModelPicker) {
            ModelPickerSheet(viewModel: viewModel)
        }
        .sheet(isPresented: $showSystemPrompt) {
            SystemPromptSheet(slotKey: viewModel.slotKey)
        }
        .sheet(isPresented: $showForkPicker) {
            ForkPickerSheet(slotKey: viewModel.slotKey)
        }
        .sheet(isPresented: $showSubagentDock) {
            SubagentDockSheet(slotKey: viewModel.slotKey)
        }
        .alert("Rename Chat", isPresented: $showRename) {
            TextField("Chat name", text: $renameText)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let trimmed = renameText.trimmingCharacters(in: .whitespaces)
                guard !trimmed.isEmpty else { return }
                Task { await viewModel.rename(title: trimmed) }
            }
        }
    }
}

// MARK: - Model Picker Sheet

struct ModelPickerSheet: View {
    @Bindable var viewModel: ChatViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @State private var searchText = ""

    private var filteredModels: [ModelInfo] {
        if searchText.isEmpty { return viewModel.availableModels }
        let q = searchText.lowercased()
        return viewModel.availableModels.filter {
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
            modelList
                .searchable(text: $searchText, prompt: "Search models")
                .navigationTitle("Select Model")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }

    @ViewBuilder
    private var modelList: some View {
        if viewModel.availableModels.isEmpty {
            ContentUnavailableView {
                Label("Loading Models…", systemImage: "cpu")
            }
        } else {
            List {
                ForEach(groupedModels, id: \.provider) { section in
                    Section(section.provider) {
                        ForEach(section.models) { model in
                            modelRow(model)
                        }
                    }
                }
            }
        }
    }

    private func modelRow(_ model: ModelInfo) -> some View {
        let isSelected = viewModel.currentModel?.id == model.id
        return Button {
            Task {
                await viewModel.setModel(model)
                dismiss()
            }
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
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(theme.accent)
                }
            }
        }
    }
}

// MARK: - Chat Empty State

private struct ChatEmptyStateView: View {
    let onSelect: (String) -> Void
    @Environment(\.appTheme) private var theme

    private let prompts = [
        (icon: "chevron.left.forwardslash.chevron.right", text: "Explain this code"),
        (icon: "doc.text",                               text: "Summarise a document"),
        (icon: "terminal",                               text: "Write a quick script"),
        (icon: "questionmark.circle",                   text: "What can you help with?")
    ]

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 48, weight: .thin))
                    .foregroundStyle(.tertiary)
                Text("Start a conversation")
                    .font(.title3.bold())
                    .foregroundStyle(.primary)
                Text("Send a message or pick a suggestion below.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            // Prompt chip grid — 2 columns
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(prompts, id: \.text) { prompt in
                    Button {
                        onSelect(prompt.text)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: prompt.icon)
                                .font(.callout)
                                .foregroundStyle(theme.accent)
                            Text(prompt.text)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(theme.infoBg)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 4)
        }
        .padding(.horizontal, 24)
    }
}

// MARK: - Context Usage Bar

private struct ContextUsageBar: View {
    let percent: Double   // 0.0 – 1.0
    @Environment(\.appTheme) private var theme

    private var tint: Color {
        if percent >= 0.95 { return theme.error }
        if percent >= 0.80 { return theme.warning }
        return theme.accent
    }

    private var label: String {
        let pct = Int((percent * 100).rounded())
        if percent >= 0.95 { return "Context nearly full (\(pct)%)" }
        if percent >= 0.80 { return "Context \(pct)% used" }
        return "Context \(pct)%"
    }

    var body: some View {
        VStack(spacing: 2) {
            ProgressView(value: min(percent, 1.0))
                .tint(tint)
                .frame(height: 2)
                .animation(.easeInOut(duration: 0.4), value: percent)
            if percent >= 0.80 {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(tint)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 14)
            }
        }
        .padding(.top, 2)
    }
}

// MARK: - Session Cost Bar

private struct SessionCostBar: View {
    let stats: TokenStatsDTO
    @Environment(\.appTheme) private var theme

    var body: some View {
        HStack(spacing: 8) {
            Label(formatTokens(stats.totalTokens), systemImage: "chart.bar.fill")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)

            dot

            Text("↑ \(formatTokens(stats.totalInputTokens))")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)

            Text("↓ \(formatTokens(stats.totalOutputTokens))")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)

            if cachePercent > 0 {
                dot
                Text("⚡ \(cachePercent)%")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(theme.accent)
            }

            if stats.totalCost > 0 {
                dot
                Text(formatCost(stats.totalCost))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        .background(theme.cardBg)
    }

    private var dot: some View {
        Text("·")
            .font(.caption2)
            .foregroundStyle(.quaternary)
    }

    private var cachePercent: Int {
        guard stats.totalInputTokens > 0 else { return 0 }
        return Int((Double(stats.cacheReadTokens) / Double(stats.totalInputTokens) * 100).rounded())
    }

    private func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fk", Double(n) / 1_000) }
        return "\(n)"
    }

    private func formatCost(_ n: Double) -> String {
        if n == 0 { return "$0" }
        if n < 0.01 { return "<$0.01" }
        return String(format: "$%.2f", n)
    }
}
