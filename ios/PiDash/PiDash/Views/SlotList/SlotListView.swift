import SwiftUI

// MARK: - SlotListView

struct SlotListView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel: SlotListViewModel?
    @State private var showSettings = false
    @State private var navigateToSlotKey: String?

    var body: some View {
        Group {
            if let vm = viewModel {
                SlotListContent(
                    viewModel: vm,
                    navigateToSlotKey: $navigateToSlotKey,
                    showSettings: $showSettings
                )
            } else {
                ProgressView()
                    .onAppear {
                        viewModel = SlotListViewModel(appState: appState)
                    }
            }
        }
    }
}

// MARK: - SlotListContent

private struct SlotListContent: View {
    @Bindable var viewModel: SlotListViewModel
    @Binding var navigateToSlotKey: String?
    @Binding var showSettings: Bool
    @Environment(AppState.self) private var appState
    @State private var renamingSlot: ChatSlot?
    @State private var renameTitle: String = ""

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                listBody
                    .searchable(text: $viewModel.searchText, prompt: "Search chats")
                    .navigationTitle("PiDash")
                    .toolbar { toolbarItems }
                    .sheet(isPresented: $showSettings) { SettingsView() }
                    .overlay(alignment: .top) {
                        ConnectionBanner(state: appState.connectionState)
                            .padding(.top, 8)
                            .animation(.spring(duration: 0.4), value: appState.connectionState.isConnected)
                    }
                    // Navigate to newly created slot
                    .navigationDestination(isPresented: Binding(
                        get: { navigateToSlotKey != nil },
                        set: { if !$0 { navigateToSlotKey = nil } }
                    )) {
                        if let key = navigateToSlotKey,
                           let slot = appState.slots.first(where: { $0.key == key }) {
                            ChatView(slot: slot)
                        }
                    }
            }
        }
    }

    @ViewBuilder
    private var listBody: some View {
        if appState.isLoadingSlots && viewModel.slots.isEmpty {
            ProgressView("Loading chats…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.slots.isEmpty && !appState.isLoadingSlots {
            EmptyStateView(
                icon: "bubble.left.and.bubble.right",
                title: "No Chats",
                message: "Start a new conversation with the + button."
            )
        } else {
            List {
                ForEach(viewModel.groupedSlots, id: \.group) { section in
                    Section(section.group.rawValue) {
                        ForEach(section.slots) { slot in
                            NavigationLink(destination: ChatView(slot: slot)) {
                                SlotRow(slot: slot)
                            }
                            .contextMenu {
                                Button {
                                    renameTitle = slot.title
                                    renamingSlot = slot
                                } label: {
                                    Label("Rename", systemImage: "pencil")
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
    }

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                Task {
                    if let newSlot = await viewModel.createNewSlot() {
                        navigateToSlotKey = newSlot.key
                    }
                }
            } label: {
                Image(systemName: "square.and.pencil")
            }
        }
        ToolbarItem(placement: .topBarLeading) {
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gear")
            }
        }
    }
}
