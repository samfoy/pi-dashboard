import Foundation

// MARK: - SlotListViewModel

/// View model for the slot list screen.
@MainActor
@Observable
final class SlotListViewModel {
    var searchText: String = ""
    var isSearching: Bool = false
    var slashCommands: [SlashCommand] = []
    var searchViewModel = SearchViewModel()

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

        // Fixed buckets in display order
        let fixed: [TemporalGroup] = [.today, .yesterday, .lastSevenDays, .lastThirtyDays]
        var result: [(group: TemporalGroup, slots: [ChatSlot])] = []
        for group in fixed {
            if let slots = grouped[group], !slots.isEmpty {
                result.append((group: group, slots: slots.sorted { $0.updatedAt > $1.updatedAt }))
            }
        }

        // Month buckets — sorted most-recent first
        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "MMMM yyyy"
        let monthKeys = grouped.keys
            .compactMap { key -> (group: TemporalGroup, date: Date)? in
                guard case .month(let label) = key,
                      let date = monthFormatter.date(from: label) else { return nil }
                return (group: key, date: date)
            }
            .sorted { $0.date > $1.date }
        for item in monthKeys {
            if let slots = grouped[item.group], !slots.isEmpty {
                result.append((group: item.group, slots: slots.sorted { $0.updatedAt > $1.updatedAt }))
            }
        }

        return result
    }

    func refresh() async {
        await appState.loadSlots()
    }

    func loadSlashCommands() async {
        guard slashCommands.isEmpty else { return }
        do {
            slashCommands = try await appState.apiClient.fetchSlashCommands()
        } catch {
            print("[SlotListVM] Failed to load slash commands: \(error)")
        }
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
