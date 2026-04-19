import SwiftUI

/// Root view — wraps the app in a NavigationSplitView.
/// On compact width (iPhone) this collapses to a standard navigation stack.
/// On regular width (iPad) this shows the sidebar + detail side by side.
struct RootView: View {
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
