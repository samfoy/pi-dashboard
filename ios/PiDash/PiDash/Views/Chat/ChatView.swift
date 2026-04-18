import SwiftUI
import MarkdownUI

// MARK: - ChatView

struct ChatView: View {
    let slot: ChatSlot
    @Environment(AppState.self) private var appState
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
            // Set default thinking level on the server
            await vm.setThinking(vm.thinkingLevel)
        }
        .onDisappear {
            appState.unregisterChatViewModel(for: slot.key)
        }
        .navigationTitle(viewModel?.slot.title ?? slot.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
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

                messageList

                ChatInputBar(
                    text: $viewModel.inputText,
                    isStreaming: viewModel.isStreaming,
                    isDisabled: viewModel.isLoadingHistory,
                    onSend: { Task { await viewModel.send() } },
                    onStop: { Task { await viewModel.stop() } }
                )
            }

            // Jump-to-bottom FAB
            if !isAtBottom {
                Button {
                    isAtBottom = true
                } label: {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(Color.accentColor)
                        .background(Circle().fill(Color(.systemBackground)))
                        .shadow(radius: 4)
                }
                .padding(.trailing, 16)
                .padding(.bottom, 80)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: isAtBottom)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if viewModel.isLoadingHistory {
                        ProgressView()
                            .padding()
                    }
                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                    // Invisible anchor at bottom
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
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
            // Detect user scrolling away from bottom
            .simultaneousGesture(
                DragGesture(minimumDistance: 10)
                    .onChanged { value in
                        // Dragging up (negative y) means scrolling up away from bottom
                        if value.translation.height > 20 {
                            isAtBottom = false
                        }
                    }
            )
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        if animated {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        } else {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }
}

// MARK: - Chat Settings Menu (Model & Thinking)

private struct ChatSettingsMenu: View {
    @Bindable var viewModel: ChatViewModel
    @State private var showModelPicker = false
    @State private var showThinkingPicker = false

    var body: some View {
        Menu {
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
                .font(.system(size: 16))
        }
        .sheet(isPresented: $showModelPicker) {
            ModelPickerSheet(viewModel: viewModel)
        }
    }
}

// MARK: - Model Picker Sheet

private struct ModelPickerSheet: View {
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
