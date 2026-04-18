import SwiftUI

// MARK: - SlotListView

struct SlotListView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel: SlotListViewModel?
    @State private var showSettings = false
    @State private var selectedSlotKey: String?

    var body: some View {
        Group {
            if let vm = viewModel {
                SlotListContent(
                    viewModel: vm,
                    selectedSlotKey: $selectedSlotKey,
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
    @Binding var selectedSlotKey: String?
    @Binding var showSettings: Bool
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.slots.isEmpty && !appState.isLoadingSlots {
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
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
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
                    .refreshable { await viewModel.refresh() }
                }
            }
            .searchable(text: $viewModel.searchText, prompt: "Search chats")
            .navigationTitle("PiDash")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            _ = await viewModel.createNewSlot()
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
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
        }
    }
}
