import Foundation

// MARK: - SlotListViewModel

/// View model for the slot list screen.
@MainActor
@Observable
final class SlotListViewModel {
    var searchText: String = ""
    var isSearching: Bool = false

    private let appState: AppState

    init(appState: AppState) {
        self.appState = appState
    }

    var slots: [ChatSlot] { appState.slots }

    var filteredSlots: [ChatSlot] {
        guard !searchText.isEmpty else { return slots }
        let q = searchText.lowercased()
        return slots.filter {
            $0.title.lowercased().contains(q) ||
            ($0.lastMessage?.lowercased().contains(q) ?? false)
        }
    }

    var groupedSlots: [(group: TemporalGroup, slots: [ChatSlot])] {
        let grouped = Dictionary(grouping: filteredSlots) {
            TemporalGroup.group(for: $0.updatedAt)
        }
        return TemporalGroup.allCases.compactMap { group in
            guard let slots = grouped[group], !slots.isEmpty else { return nil }
            return (group: group, slots: slots.sorted { $0.updatedAt > $1.updatedAt })
        }
    }

    func refresh() async {
        await appState.loadSlots()
    }

    func createNewSlot() async -> ChatSlot? {
        await appState.createSlot()
    }

    func delete(slotKey: String) async {
        await appState.deleteSlot(key: slotKey)
    }

    func rename(slotKey: String, title: String) async {
        await appState.renameSlot(key: slotKey, title: title)
    }
}
