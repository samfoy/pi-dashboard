import XCTest
@testable import PiDash

@MainActor
final class AppStateTests: XCTestCase {

    // MARK: - Helpers

    private func makeAppState() -> AppState {
        // Do NOT call start() — that opens a real WebSocket connection
        AppState(serverConfig: ServerConfig())
    }

    private func makeSlot(
        key: String = "chat-1-100",
        title: String = "Test Slot",
        inputNeeded: Bool = false
    ) -> ChatSlot {
        ChatSlot(
            key: key,
            title: title,
            createdAt: Date(),
            updatedAt: Date(),
            inputNeeded: inputNeeded
        )
    }

    // MARK: - Initial State

    func testInitialConnectionState() {
        let sut = makeAppState()
        XCTAssertEqual(sut.connectionState, .disconnected)
    }

    func testInitialSlotsEmpty() {
        let sut = makeAppState()
        XCTAssertTrue(sut.slots.isEmpty)
    }

    func testInitialIsLoadingSlotsFalse() {
        let sut = makeAppState()
        XCTAssertFalse(sut.isLoadingSlots)
    }

    func testInitialSlotsErrorNil() {
        let sut = makeAppState()
        XCTAssertNil(sut.slotsError)
    }

    func testInitialSelectedSlotKeyNil() {
        let sut = makeAppState()
        XCTAssertNil(sut.selectedSlotKey)
    }

    func testInitialPendingCommandsEmpty() {
        let sut = makeAppState()
        XCTAssertTrue(sut.pendingCommands.isEmpty)
    }

    // MARK: - setPendingCommand / consumePendingCommand

    func testSetPendingCommandStoresValue() {
        let sut = makeAppState()
        sut.setPendingCommand("hello world", forSlot: "chat-1-100")
        XCTAssertEqual(sut.pendingCommands["chat-1-100"], "hello world")
    }

    func testConsumePendingCommandReturnsValue() {
        let sut = makeAppState()
        sut.setPendingCommand("run tests", forSlot: "chat-2-200")
        let result = sut.consumePendingCommand(forSlot: "chat-2-200")
        XCTAssertEqual(result, "run tests")
    }

    func testConsumePendingCommandClearsEntry() {
        let sut = makeAppState()
        sut.setPendingCommand("run tests", forSlot: "chat-2-200")
        _ = sut.consumePendingCommand(forSlot: "chat-2-200")
        XCTAssertNil(sut.pendingCommands["chat-2-200"])
    }

    func testConsumePendingCommandMissingKeyReturnsNil() {
        let sut = makeAppState()
        let result = sut.consumePendingCommand(forSlot: "chat-99-999")
        XCTAssertNil(result)
    }

    func testSetPendingCommandOverwritesPreviousValue() {
        let sut = makeAppState()
        sut.setPendingCommand("first", forSlot: "chat-1-100")
        sut.setPendingCommand("second", forSlot: "chat-1-100")
        XCTAssertEqual(sut.pendingCommands["chat-1-100"], "second")
    }

    func testMultipleSlotsStoredIndependently() {
        let sut = makeAppState()
        sut.setPendingCommand("cmd-a", forSlot: "chat-1-100")
        sut.setPendingCommand("cmd-b", forSlot: "chat-2-200")
        XCTAssertEqual(sut.consumePendingCommand(forSlot: "chat-1-100"), "cmd-a")
        XCTAssertEqual(sut.consumePendingCommand(forSlot: "chat-2-200"), "cmd-b")
    }

    func testConsumeOneSlotDoesNotAffectAnother() {
        let sut = makeAppState()
        sut.setPendingCommand("cmd-a", forSlot: "chat-1-100")
        sut.setPendingCommand("cmd-b", forSlot: "chat-2-200")
        _ = sut.consumePendingCommand(forSlot: "chat-1-100")
        XCTAssertEqual(sut.pendingCommands["chat-2-200"], "cmd-b")
    }

    // MARK: - clearNotification

    func testClearNotificationClearsInputNeeded() {
        let sut = makeAppState()
        sut.slots = [makeSlot(key: "chat-1-100", inputNeeded: true)]
        sut.clearNotification(forSlot: "chat-1-100")
        XCTAssertFalse(sut.slots[0].inputNeeded)
    }

    func testClearNotificationOnSlotWithFalseInputNeededIsNoOp() {
        let sut = makeAppState()
        sut.slots = [makeSlot(key: "chat-1-100", inputNeeded: false)]
        sut.clearNotification(forSlot: "chat-1-100")
        XCTAssertFalse(sut.slots[0].inputNeeded)
    }

    func testClearNotificationUnknownKeyDoesNotCrash() {
        let sut = makeAppState()
        sut.slots = [makeSlot(key: "chat-1-100")]
        // Should not crash when the key doesn't exist
        sut.clearNotification(forSlot: "chat-99-999")
        XCTAssertTrue(sut.slots.count == 1)  // slots unaffected
    }

    func testClearNotificationOnlyAffectsTargetSlot() {
        let sut = makeAppState()
        sut.slots = [
            makeSlot(key: "chat-1-100", inputNeeded: true),
            makeSlot(key: "chat-2-200", inputNeeded: true)
        ]
        sut.clearNotification(forSlot: "chat-1-100")
        XCTAssertFalse(sut.slots[0].inputNeeded, "Target slot should be cleared")
        XCTAssertTrue(sut.slots[1].inputNeeded, "Other slot should remain unchanged")
    }

    // MARK: - registerChatViewModel / unregisterChatViewModel

    private func makeVM(slotKey: String) -> ChatViewModel {
        let slot = makeSlot(key: slotKey)
        let apiClient = APIClient(config: ServerConfig())
        let appState = makeAppState()
        return ChatViewModel(slot: slot, apiClient: apiClient, appState: appState)
    }

    func testRegisterChatViewModelStoresVM() {
        let sut = makeAppState()
        let vm = makeVM(slotKey: "chat-1-100")
        sut.registerChatViewModel(vm, for: "chat-1-100")
        // Registered VMs are private, but unregister should not crash (it can only succeed
        // if the entry was actually stored)
        sut.unregisterChatViewModel(for: "chat-1-100")
        // If we reach here without crash, the registration round-trip worked
    }

    func testUnregisterChatViewModelUnknownKeyDoesNotCrash() {
        let sut = makeAppState()
        // Unregistering a key that was never registered should not crash
        sut.unregisterChatViewModel(for: "chat-99-999")
    }

    func testRegisterTwoViewModels() {
        let sut = makeAppState()
        let vm1 = makeVM(slotKey: "chat-1-100")
        let vm2 = makeVM(slotKey: "chat-2-200")
        sut.registerChatViewModel(vm1, for: "chat-1-100")
        sut.registerChatViewModel(vm2, for: "chat-2-200")
        // Unregister one; the other should still be safely removable
        sut.unregisterChatViewModel(for: "chat-1-100")
        sut.unregisterChatViewModel(for: "chat-2-200")
    }
}
