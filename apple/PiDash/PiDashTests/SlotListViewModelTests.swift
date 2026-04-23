import XCTest
@testable import PiDash

@MainActor
final class SlotListViewModelTests: XCTestCase {

    // MARK: - Helpers

    /// Create a bare AppState (no server, no WS, no start() call) for isolated logic tests.
    private func makeAppState() -> AppState {
        AppState(serverConfig: ServerConfig())
    }

    /// Build a ChatSlot with a controlled updatedAt date.
    private func makeSlot(
        key: String,
        title: String,
        updatedAt: Date = Date(),
        lastMessage: String? = nil
    ) -> ChatSlot {
        ChatSlot(
            key: key,
            title: title,
            createdAt: updatedAt,
            updatedAt: updatedAt,
            lastMessage: lastMessage
        )
    }

    // MARK: - Initial State

    func testInitialSearchTextIsEmpty() {
        let vm = SlotListViewModel(appState: makeAppState())
        XCTAssertEqual(vm.searchText, "")
    }

    func testInitialIsSearchingIsFalse() {
        let vm = SlotListViewModel(appState: makeAppState())
        XCTAssertFalse(vm.isSearching)
    }

    func testInitialSlashCommandsIsEmpty() {
        let vm = SlotListViewModel(appState: makeAppState())
        XCTAssertTrue(vm.slashCommands.isEmpty)
    }

    // MARK: - slots mirrors AppState

    func testSlotsMirrorsAppState() {
        let appState = makeAppState()
        let vm = SlotListViewModel(appState: appState)

        XCTAssertTrue(vm.slots.isEmpty)

        let slot = makeSlot(key: "chat-1-100", title: "Alpha")
        appState.slots = [slot]

        XCTAssertEqual(vm.slots.count, 1)
        XCTAssertEqual(vm.slots.first?.key, "chat-1-100")
    }

    func testSlotsReflectsMultipleEntries() {
        let appState = makeAppState()
        let vm = SlotListViewModel(appState: appState)

        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Alpha"),
            makeSlot(key: "chat-2-200", title: "Beta"),
            makeSlot(key: "chat-3-300", title: "Gamma")
        ]

        XCTAssertEqual(vm.slots.count, 3)
    }

    // MARK: - filteredSlots (empty search → all slots returned)

    func testFilteredSlotsEmptySearchReturnsAll() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Alpha"),
            makeSlot(key: "chat-2-200", title: "Beta")
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = ""

        XCTAssertEqual(vm.filteredSlots.count, 2)
    }

    // MARK: - filteredSlots (title matching)

    func testFilteredSlotsByTitleExactSubstring() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Alpha project"),
            makeSlot(key: "chat-2-200", title: "Beta work"),
            makeSlot(key: "chat-3-300", title: "Gamma alpha")
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "alpha"

        XCTAssertEqual(vm.filteredSlots.count, 2)
        XCTAssertTrue(vm.filteredSlots.allSatisfy {
            $0.title.lowercased().contains("alpha")
        })
    }

    func testFilteredSlotsTitleMatchIsCaseInsensitive() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "My Research"),
            makeSlot(key: "chat-2-200", title: "Unrelated")
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "RESEARCH"

        XCTAssertEqual(vm.filteredSlots.count, 1)
        XCTAssertEqual(vm.filteredSlots.first?.key, "chat-1-100")
    }

    func testFilteredSlotsNoMatchReturnsEmpty() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Alpha"),
            makeSlot(key: "chat-2-200", title: "Beta")
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "zzz"

        XCTAssertTrue(vm.filteredSlots.isEmpty)
    }

    // MARK: - filteredSlots (lastMessage matching)

    func testFilteredSlotsByLastMessage() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Work session", lastMessage: "deploy the service"),
            makeSlot(key: "chat-2-200", title: "Other chat", lastMessage: nil)
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "deploy"

        XCTAssertEqual(vm.filteredSlots.count, 1)
        XCTAssertEqual(vm.filteredSlots.first?.key, "chat-1-100")
    }

    func testFilteredSlotsLastMessageMatchIsCaseInsensitive() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Work", lastMessage: "Deploy the service"),
            makeSlot(key: "chat-2-200", title: "Other", lastMessage: nil)
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "DEPLOY"

        XCTAssertEqual(vm.filteredSlots.count, 1)
    }

    func testFilteredSlotsNilLastMessageDoesNotCrash() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Chat", lastMessage: nil)
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "something"

        // nil lastMessage → no match, no crash
        XCTAssertTrue(vm.filteredSlots.isEmpty)
    }

    func testFilteredSlotsTitleAndLastMessageBothMatch() {
        let appState = makeAppState()
        // Slot A matches on title; slot B matches on lastMessage; slot C matches neither
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "foo bar", lastMessage: "hello"),
            makeSlot(key: "chat-2-200", title: "irrelevant", lastMessage: "foo baz"),
            makeSlot(key: "chat-3-300", title: "other", lastMessage: "nothing here")
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "foo"

        XCTAssertEqual(vm.filteredSlots.count, 2)
        let keys = vm.filteredSlots.map(\.key)
        XCTAssertTrue(keys.contains("chat-1-100"))
        XCTAssertTrue(keys.contains("chat-2-200"))
    }

    // MARK: - groupedSlots

    func testGroupedSlotsEmptySlotsReturnsEmpty() {
        let appState = makeAppState()
        let vm = SlotListViewModel(appState: appState)
        XCTAssertTrue(vm.groupedSlots.isEmpty)
    }

    func testGroupedSlotsTodaySlotAppearsInTodayGroup() {
        let appState = makeAppState()
        appState.slots = [makeSlot(key: "chat-1-100", title: "Today Slot", updatedAt: Date())]
        let vm = SlotListViewModel(appState: appState)

        let groups = vm.groupedSlots
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.group, .today)
        XCTAssertEqual(groups.first?.slots.first?.key, "chat-1-100")
    }

    func testGroupedSlotsYesterdaySlotAppearsInYesterdayGroup() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let appState = makeAppState()
        appState.slots = [makeSlot(key: "chat-1-100", title: "Yesterday Slot", updatedAt: yesterday)]
        let vm = SlotListViewModel(appState: appState)

        let groups = vm.groupedSlots
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.group, .yesterday)
    }

    func testGroupedSlotsLastSevenDays() {
        let fiveDaysAgo = Calendar.current.date(byAdding: .day, value: -5, to: Date())!
        let appState = makeAppState()
        appState.slots = [makeSlot(key: "chat-1-100", title: "5d ago", updatedAt: fiveDaysAgo)]
        let vm = SlotListViewModel(appState: appState)

        let groups = vm.groupedSlots
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.group, .lastSevenDays)
    }

    func testGroupedSlotsLastThirtyDays() {
        let twentyDaysAgo = Calendar.current.date(byAdding: .day, value: -20, to: Date())!
        let appState = makeAppState()
        appState.slots = [makeSlot(key: "chat-1-100", title: "20d ago", updatedAt: twentyDaysAgo)]
        let vm = SlotListViewModel(appState: appState)

        let groups = vm.groupedSlots
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.group, .lastThirtyDays)
    }

    func testGroupedSlotsOldSlotFallsIntoMonthGroup() {
        let sixtyDaysAgo = Calendar.current.date(byAdding: .day, value: -60, to: Date())!
        let appState = makeAppState()
        appState.slots = [makeSlot(key: "chat-1-100", title: "Old", updatedAt: sixtyDaysAgo)]
        let vm = SlotListViewModel(appState: appState)

        let groups = vm.groupedSlots
        XCTAssertEqual(groups.count, 1)
        if case .month(let label) = groups.first?.group {
            XCTAssertFalse(label.isEmpty)
        } else {
            XCTFail("Expected .month group for slot 60 days old, got \(String(describing: groups.first?.group))")
        }
    }

    func testGroupedSlotsMultipleGroupsOrderedCorrectly() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let fiveDaysAgo = Calendar.current.date(byAdding: .day, value: -5, to: Date())!
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Today Slot", updatedAt: Date()),
            makeSlot(key: "chat-2-200", title: "Yesterday Slot", updatedAt: yesterday),
            makeSlot(key: "chat-3-300", title: "5-day Slot", updatedAt: fiveDaysAgo)
        ]
        let vm = SlotListViewModel(appState: appState)

        let groups = vm.groupedSlots
        XCTAssertEqual(groups.count, 3)
        XCTAssertEqual(groups[0].group, .today)
        XCTAssertEqual(groups[1].group, .yesterday)
        XCTAssertEqual(groups[2].group, .lastSevenDays)
    }

    func testGroupedSlotsSortedDescendingWithinGroup() {
        // Use second-level offsets so all three slots stay in today's calendar day
        // regardless of what time the test runner executes.
        let now = Date()
        let slightlyEarlier = now.addingTimeInterval(-2)
        let evenSlightlyEarlier = now.addingTimeInterval(-4)
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Earliest", updatedAt: evenSlightlyEarlier),
            makeSlot(key: "chat-2-200", title: "Latest", updatedAt: now),
            makeSlot(key: "chat-3-300", title: "Middle", updatedAt: slightlyEarlier)
        ]
        let vm = SlotListViewModel(appState: appState)

        let todayGroup = vm.groupedSlots.first { $0.group == .today }
        XCTAssertNotNil(todayGroup)
        let keys = todayGroup!.slots.map(\.key)
        XCTAssertEqual(keys, ["chat-2-200", "chat-3-300", "chat-1-100"])
    }

    func testGroupedSlotsOnlyShowsGroupsWithSlots() {
        // Only today's slot present — yesterday, lastSevenDays, lastThirtyDays should be absent
        let appState = makeAppState()
        appState.slots = [makeSlot(key: "chat-1-100", title: "Only Today", updatedAt: Date())]
        let vm = SlotListViewModel(appState: appState)

        let groupNames = vm.groupedSlots.map(\.group)
        XCTAssertFalse(groupNames.contains(.yesterday))
        XCTAssertFalse(groupNames.contains(.lastSevenDays))
        XCTAssertFalse(groupNames.contains(.lastThirtyDays))
    }

    // MARK: - groupedSlots respects filtered (searchText) slots

    func testGroupedSlotsUsesFilteredSlots() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Alpha today", updatedAt: Date()),
            makeSlot(key: "chat-2-200", title: "Beta today", updatedAt: Date())
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "alpha"

        // Only "alpha" slot should appear in groupedSlots
        let groups = vm.groupedSlots
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.slots.count, 1)
        XCTAssertEqual(groups.first?.slots.first?.key, "chat-1-100")
    }

    func testGroupedSlotsEmptyWhenSearchMatchesNothing() {
        let appState = makeAppState()
        appState.slots = [
            makeSlot(key: "chat-1-100", title: "Alpha", updatedAt: Date())
        ]
        let vm = SlotListViewModel(appState: appState)
        vm.searchText = "zzz"

        XCTAssertTrue(vm.groupedSlots.isEmpty)
    }
}
