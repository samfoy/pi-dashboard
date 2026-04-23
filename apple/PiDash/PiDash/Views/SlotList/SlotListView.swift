import SwiftUI

// MARK: - SlotListView

struct SlotListView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel: SlotListViewModel?
    @State private var showSettings = false

    var body: some View {
        Group {
            if let vm = viewModel {
                SlotListContent(
                    viewModel: vm,
                    showSettings: $showSettings
                )
            } else {
                ProgressView()
                    .onAppear {
                        viewModel = SlotListViewModel(appState: appState)
                    }
            }
        }
        .onChange(of: appState.pendingDeepLinkKey) { _, newKey in
            guard let key = newKey else { return }
            appState.selectedSlotKey = key
            appState.pendingDeepLinkKey = nil
        }
    }
}

// MARK: - SlotListContent

private struct SlotListContent: View {
    @Bindable var viewModel: SlotListViewModel
    @Binding var showSettings: Bool
    @Environment(AppState.self) private var appState
    @State private var renamingSlot: ChatSlot?
    @State private var renameTitle: String = ""
    @State private var showSessionHistory = false
    @State private var taggingSlot: ChatSlot?
    @State private var showProjectPicker = false

    var body: some View {
        ZStack(alignment: .top) {
            listBody
                .searchable(text: $viewModel.searchText, prompt: "Search chats")
                .onChange(of: viewModel.searchText) { _, query in
                    viewModel.searchViewModel.search(
                        query: query,
                        slots: viewModel.slots,
                        apiClient: appState.apiClient
                    )
                }
                .navigationTitle("PiDash")
                .toolbar { toolbarItems }
                .task { await viewModel.loadSlashCommands() }
                .sheet(isPresented: $showSettings) { SettingsView() }
                .sheet(item: $taggingSlot) { slot in
                    TagEditorSheet(
                        slot: slot,
                        apiClient: appState.apiClient
                    ) { newTags in
                        if let i = appState.slots.firstIndex(where: { $0.key == slot.key }) {
                            appState.slots[i].tags = newTags
                        }
                        TagEditorSheet.recordTags(newTags)
                    }
                }
                .sheet(isPresented: $showSessionHistory) {
                    SessionHistoryView { newSlotKey in
                        appState.selectedSlotKey = newSlotKey
                    }
                    .environment(appState)
                }
                .sheet(isPresented: $showProjectPicker) {
                    ProjectPickerSheet(
                        slots: viewModel.slots,
                        apiClient: appState.apiClient
                    ) { cwd in
                        Task {
                            if let newSlot = await viewModel.createNewSlot(cwd: cwd) {
                                appState.selectedScrollTarget = nil
                                appState.selectedSlotKey = newSlot.key
                            }
                        }
                    }
                }
                .overlay(alignment: .top) {
                    ConnectionBanner(state: appState.connectionState) {
                        appState.wsManager.connect()
                    }
                        .padding(.top, 8)
                        .animation(.spring(duration: 0.4), value: appState.connectionState.isConnected)
                }
        }
    }

    @ViewBuilder
    private var listBody: some View {
        if !viewModel.searchText.isEmpty {
            SearchResultsView(
                results: viewModel.searchViewModel.results,
                isSearching: viewModel.searchViewModel.isSearching,
                query: viewModel.searchText,
                onSelect: { slot, messageId in
                    appState.selectedScrollTarget = messageId
                    appState.selectedSlotKey = slot.key
                }
            )
        } else if appState.isLoadingSlots && viewModel.slots.isEmpty {
            ProgressView("Loading chats…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.slots.isEmpty && !appState.isLoadingSlots {
            EmptyStateView(
                icon: "bubble.left.and.bubble.right",
                title: "No Chats",
                message: "Start a new conversation with the + button."
            )
        } else {
            chatList
        }
    }

    private var chatList: some View {
        List(selection: Binding(
            get: { appState.selectedSlotKey },
            set: { appState.selectedSlotKey = $0 }
        )) {
                ForEach(viewModel.groupedSlots, id: \.group) { section in
                    Section(section.group.label) {
                        ForEach(section.slots) { slot in
                            NavigationLink(value: slot.key) {
                                SlotRow(slot: slot)
                            }
                            .contextMenu {
                                Button {
                                    renameTitle = slot.title
                                    renamingSlot = slot
                                } label: {
                                    Label("Rename", systemImage: "pencil")
                                }
                                Button {
                                    taggingSlot = slot
                                } label: {
                                    Label("Tags", systemImage: "tag")
                                }
                                Button(role: .destructive) {
                                    HapticManager.slotDeleted()
                                    Task { await viewModel.delete(slotKey: slot.key) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    HapticManager.slotDeleted()
                                    Task { await viewModel.delete(slotKey: slot.key) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .animation(.default, value: viewModel.filteredSlots.count)
            .refreshable { await viewModel.refresh() }
            .alert("Rename Chat", isPresented: Binding(
                get: { renamingSlot != nil },
                set: { if !$0 { renamingSlot = nil } }
            )) {
                TextField("Chat name", text: $renameTitle)
                Button("Save") {
                    guard let slot = renamingSlot, !renameTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    let newTitle = renameTitle.trimmingCharacters(in: .whitespaces)
                    Task { await viewModel.rename(slotKey: slot.key, title: newTitle) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Enter a new name for this chat.")
            }
    }

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            // Tap: quick new chat with default cwd
            // Long-press: project picker → new chat with chosen cwd
            Button {
                Task {
                    if let newSlot = await viewModel.createNewSlot() {
                        appState.selectedScrollTarget = nil
                        appState.selectedSlotKey = newSlot.key
                    }
                }
            } label: {
                Image(systemName: "square.and.pencil")
            }
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                    showProjectPicker = true
                }
            )
        }
        ToolbarItem(placement: .topBarLeading) {
            HStack(spacing: 16) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gear")
                }
                Button {
                    showSessionHistory = true
                } label: {
                    Image(systemName: "clock.arrow.circlepath")
                }
            }
        }
    }
}
