import SwiftUI

/// Root view — tab bar with Chats and Workflows.
/// Each tab owns its own NavigationSplitView / NavigationStack.
struct RootView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedTab: AppTab = .chats

    var body: some View {
        TabView(selection: $selectedTab) {
            ChatsTab()
                .tag(AppTab.chats)
                .tabItem {
                    Label("Chats", systemImage: "bubble.left.and.bubble.right")
                }

            WorkflowsTab()
                .tag(AppTab.workflows)
                .tabItem {
                    Label("Workflows", systemImage: "gearshape.2")
                }
        }
    }
}

// MARK: - AppTab

enum AppTab: Hashable {
    case chats
    case workflows
}

// MARK: - ChatsTab

/// Preserves the existing NavigationSplitView chat experience.
private struct ChatsTab: View {
    @Environment(AppState.self) private var appState
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        @Bindable var appState = appState
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SlotListView()
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
