import SwiftUI

/// Root view — chats with a Workflows sheet accessible from the toolbar.
struct RootView: View {
    @Environment(AppState.self) private var appState
    @State private var showWorkflows = false

    var body: some View {
        ChatsTab(showWorkflows: $showWorkflows)
            .sheet(isPresented: $showWorkflows) {
                WorkflowsTab()
            }
    }
}

// MARK: - ChatsTab

/// Preserves the existing NavigationSplitView chat experience.
private struct ChatsTab: View {
    @Environment(AppState.self) private var appState
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @Binding var showWorkflows: Bool

    var body: some View {
        @Bindable var appState = appState
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SlotListView(showWorkflows: $showWorkflows)
                .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 360)
        } detail: {
            NavigationStack {
                if let key = appState.selectedSlotKey,
                   let slot = appState.slots.first(where: { $0.key == key }) {
                    ChatView(slot: slot, scrollToMessageId: appState.selectedScrollTarget)
                } else {
                    NoChatSelectedView()
                }
            }
        }
    }
}

// MARK: - WorkflowsTab

private struct WorkflowsTab: View {
    var body: some View {
        WorkflowsListView()
    }
}
