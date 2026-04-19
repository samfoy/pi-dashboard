import SwiftUI
import MarkdownUI

// MARK: - ChatView

struct ChatView: View {
    let slot: ChatSlot
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewModel: ChatViewModel?

    var body: some View {
        Group {
            if let vm = viewModel {
                ChatContentView(viewModel: vm)
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
            await vm.loadHistory()
            await vm.loadModels()
            await vm.loadSlashCommands()
            // Set default thinking level on the server
            await vm.setThinking(vm.thinkingLevel)
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
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(viewModel?.slot.title ?? slot.title)
                        .font(.headline)
                        .lineLimit(1)
                    if let modelName = viewModel?.currentModel?.name ?? viewModel?.slot.model {
                        Text(modelName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
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
    @State private var isAtBottom = true
    @State private var showCommandPalette = false
    @State private var showModelPickerFromToolbar = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let healthService = HealthKitService.shared
    private let calendarService = CalendarService.shared
    private let remindersService = RemindersService.shared
    private let contactsService = ContactsService.shared

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
                    .background(Color.red)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                // Context usage bar — shown when approaching context limit
                if let pct = viewModel.slot.contextPercent, pct > 0.5 {
                    ContextUsageBar(percent: pct)
                        .transition(.opacity)
                }

                messageList

                ChatInputBar(
                    text: $viewModel.inputText,
                    pendingImages: $viewModel.pendingImages,
                    isStreaming: viewModel.isStreaming,
                    isDisabled: viewModel.isLoadingHistory,
                    contextPercent: viewModel.slot.contextPercent,
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
                    onSend: { Task { await viewModel.send() } },
                    onStop: { Task { await viewModel.stop() } }
                )
                .sheet(isPresented: $showCommandPalette) {
                    CommandPaletteSheet(commands: viewModel.slashCommands) { cmd in
                        Task { await viewModel.sendCommand(cmd.name) }
                    }
                }
                .sheet(isPresented: $showModelPickerFromToolbar) {
                    ModelPickerSheet(viewModel: viewModel)
                }
            }

            // Jump-to-bottom FAB
            if !isAtBottom {
                Button {
                    isAtBottom = true
                } label: {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.title)
                        .foregroundStyle(Color.accentColor)
                        .background(Circle().fill(Color(.systemBackground)))
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
                        MessageBubble(message: message)
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
            .defaultScrollAnchor(.bottom)
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
            // Real bottom detection via sentinel onAppear/onDisappear (iOS 17 compatible)
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        if animated && !reduceMotion {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        } else {
            // Explicit .none suppresses any inherited animation context (prevents streaming jank)
            withAnimation(.none) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }
}

// MARK: - Chat Settings Menu (Model & Thinking)

private struct ChatSettingsMenu: View {
    @Bindable var viewModel: ChatViewModel
    @State private var showModelPicker = false
    @State private var showThinkingPicker = false
    @State private var showRename = false
    @State private var renameText = ""

    var body: some View {
        Menu {
            // Rename
            Button {
                renameText = viewModel.slot.title
                showRename = true
            } label: {
                Label("Rename", systemImage: "pencil")
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
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
    }
}

// MARK: - Chat Empty State

private struct ChatEmptyStateView: View {
    let onSelect: (String) -> Void

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
                                .foregroundStyle(Color.accentColor)
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
                                .fill(Color(.systemGray6))
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

    private var tint: Color {
        if percent >= 0.95 { return .red }
        if percent >= 0.80 { return .yellow }
        return Color.accentColor
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
