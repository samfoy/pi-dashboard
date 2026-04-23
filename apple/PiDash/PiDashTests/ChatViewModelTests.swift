import XCTest
@testable import PiDash

@MainActor
final class ChatViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeSlot(key: String = "chat-1-100", title: String = "Test Slot") -> ChatSlot {
        ChatSlot(
            key: key,
            title: title,
            createdAt: Date(),
            updatedAt: Date(),
            lastMessage: nil
        )
    }

    /// Build a MessageMetaDTO without a live decoder by encoding a JSON dict.
    private func makeMetaDTO(
        model: String? = nil,
        inputTokens: Int? = nil,
        outputTokens: Int? = nil
    ) -> MessageMetaDTO? {
        var dict: [String: Any] = [:]
        if let m = model { dict["model"] = m }
        if let it = inputTokens { dict["input_tokens"] = it }
        if let ot = outputTokens { dict["output_tokens"] = ot }
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        return try? JSONDecoder().decode(MessageMetaDTO.self, from: data)
    }

    private func makeVM(slotKey: String = "chat-1-100") -> ChatViewModel {
        let slot = makeSlot(key: slotKey)
        let apiClient = APIClient(config: ServerConfig())
        let appState = AppState(serverConfig: ServerConfig())
        return ChatViewModel(slot: slot, apiClient: apiClient, appState: appState)
    }

    // MARK: - Initial State

    func testInitialMessagesIsEmpty() {
        let vm = makeVM()
        XCTAssertTrue(vm.messages.isEmpty)
    }

    func testInitialInputTextIsEmpty() {
        let vm = makeVM()
        XCTAssertEqual(vm.inputText, "")
    }

    func testInitialIsStreamingIsFalse() {
        let vm = makeVM()
        XCTAssertFalse(vm.isStreaming)
    }

    func testInitialIsLoadingHistoryIsFalse() {
        let vm = makeVM()
        XCTAssertFalse(vm.isLoadingHistory)
    }

    func testInitialErrorIsNil() {
        let vm = makeVM()
        XCTAssertNil(vm.error)
    }

    func testInitialThinkingLevelIsMedium() {
        let vm = makeVM()
        XCTAssertEqual(vm.thinkingLevel, "medium")
    }

    func testInitialCurrentModelIsNil() {
        let vm = makeVM()
        XCTAssertNil(vm.currentModel)
    }

    func testInitialAvailableModelsIsEmpty() {
        let vm = makeVM()
        XCTAssertTrue(vm.availableModels.isEmpty)
    }

    func testInitialSlashCommandsIsEmpty() {
        let vm = makeVM()
        XCTAssertTrue(vm.slashCommands.isEmpty)
    }

    func testSlotKeyMatchesConstructedSlot() {
        let vm = makeVM(slotKey: "chat-42-999")
        XCTAssertEqual(vm.slotKey, "chat-42-999")
    }

    // MARK: - thinkingLevels static array

    func testThinkingLevelsOrder() {
        XCTAssertEqual(
            ChatViewModel.thinkingLevels,
            ["off", "minimal", "low", "medium", "high", "xhigh"]
        )
    }

    func testThinkingLevelsContainsMedium() {
        XCTAssertTrue(ChatViewModel.thinkingLevels.contains("medium"))
    }

    // MARK: - handle(event:) — chatChunk for correct slot

    func testChatChunkAppendsContentToStreamingPlaceholder() {
        let vm = makeVM()
        // Seed a streaming placeholder manually by sending a chunk (creates one when none exists)
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "Hello", seq: nil))

        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertEqual(vm.messages[0].content, "Hello")
        XCTAssertTrue(vm.messages[0].isStreaming)
    }

    func testChatChunkAccumulatesContent() {
        let vm = makeVM()
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "Hello", seq: nil))
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: " world", seq: nil))

        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertEqual(vm.messages[0].content, "Hello world")
    }

    func testChatChunkSetsIsStreamingTrue() {
        let vm = makeVM()
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "hi", seq: nil))
        XCTAssertTrue(vm.isStreaming)
    }

    func testChatChunkForWrongSlotIsIgnored() {
        let vm = makeVM(slotKey: "chat-1-100")
        vm.handle(event: .chatChunk(slot: "chat-99-999", content: "other", seq: nil))
        XCTAssertTrue(vm.messages.isEmpty)
        XCTAssertFalse(vm.isStreaming)
    }

    // MARK: - handle(event:) — chatDone

    func testChatDoneFinalizesStreamingMessage() {
        let vm = makeVM()
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "Done!", seq: nil))
        XCTAssertTrue(vm.isStreaming)

        vm.handle(event: .chatDone(slot: "chat-1-100"))
        XCTAssertFalse(vm.isStreaming)
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertFalse(vm.messages[0].isStreaming)
    }

    func testChatDoneForWrongSlotDoesNotClearStreaming() {
        let vm = makeVM(slotKey: "chat-1-100")
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "streaming", seq: nil))
        XCTAssertTrue(vm.isStreaming)

        vm.handle(event: .chatDone(slot: "chat-99-999"))
        // streaming should still be active — wrong slot
        XCTAssertTrue(vm.isStreaming)
    }

    func testChatDoneWithNoActiveStreamingIsHarmless() {
        let vm = makeVM()
        // No streaming in progress — chatDone should not crash or mutate state
        vm.handle(event: .chatDone(slot: "chat-1-100"))
        XCTAssertFalse(vm.isStreaming)
        XCTAssertTrue(vm.messages.isEmpty)
    }

    // MARK: - handle(event:) — chatMessage (inbound)

    func testChatMessageAssistantReplacesStreamingPlaceholder() {
        let vm = makeVM()
        // Start a streaming session
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "partial", seq: nil))
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertTrue(vm.messages[0].isStreaming)

        // Final chatMessage replaces the placeholder
        vm.handle(event: .chatMessage(
            slot: "chat-1-100",
            role: "assistant",
            content: "final answer",
            ts: nil,
            meta: nil
        ))
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertEqual(vm.messages[0].content, "final answer")
        XCTAssertFalse(vm.messages[0].isStreaming)
    }

    func testChatMessageAssistantWithNoPlaceholderAppends() {
        let vm = makeVM()
        vm.handle(event: .chatMessage(
            slot: "chat-1-100",
            role: "assistant",
            content: "hello",
            ts: nil,
            meta: nil
        ))
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertEqual(vm.messages[0].content, "hello")
        XCTAssertEqual(vm.messages[0].role, .assistant)
    }

    func testChatMessageUserRoleAppendsMessage() {
        let vm = makeVM()
        vm.handle(event: .chatMessage(
            slot: "chat-1-100",
            role: "user",
            content: "my question",
            ts: nil,
            meta: nil
        ))
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertEqual(vm.messages[0].role, .user)
        XCTAssertEqual(vm.messages[0].content, "my question")
    }

    func testChatMessageThinkingRoleAlwaysAppends() {
        let vm = makeVM()
        // Start a streaming session — thinking messages append alongside, not replacing
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "partial", seq: nil))
        vm.handle(event: .chatMessage(
            slot: "chat-1-100",
            role: "thinking",
            content: "thinking block",
            ts: nil,
            meta: nil
        ))
        // Both placeholder and thinking message should be present
        XCTAssertEqual(vm.messages.count, 2)
        let thinkingMsgs = vm.messages.filter { $0.role == .thinking }
        XCTAssertEqual(thinkingMsgs.count, 1)
        XCTAssertEqual(thinkingMsgs[0].content, "thinking block")
    }

    func testChatMessageForWrongSlotIsIgnored() {
        let vm = makeVM(slotKey: "chat-1-100")
        vm.handle(event: .chatMessage(
            slot: "chat-99-999",
            role: "assistant",
            content: "sneaky",
            ts: nil,
            meta: nil
        ))
        XCTAssertTrue(vm.messages.isEmpty)
    }

    func testChatMessageSetsMetaFields() {
        let vm = makeVM()
        let meta = makeMetaDTO(model: "claude-opus-4", inputTokens: 10, outputTokens: 20)
        vm.handle(event: .chatMessage(
            slot: "chat-1-100",
            role: "assistant",
            content: "response",
            ts: nil,
            meta: meta
        ))
        XCTAssertEqual(vm.messages[0].meta?.model, "claude-opus-4")
        XCTAssertEqual(vm.messages[0].meta?.inputTokens, 10)
        XCTAssertEqual(vm.messages[0].meta?.outputTokens, 20)
    }

    // MARK: - handle(event:) — toolCall

    func testToolCallAppendsToolMessage() {
        let vm = makeVM()
        vm.handle(event: .toolCall(
            slot: "chat-1-100",
            tool: "read_file",
            id: "tc-001",
            args: nil
        ))
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertEqual(vm.messages[0].role, .tool)
        XCTAssertTrue(vm.messages[0].content.contains("read_file"))
    }

    func testToolCallStoresToolNameAndId() {
        let vm = makeVM()
        vm.handle(event: .toolCall(
            slot: "chat-1-100",
            tool: "bash",
            id: "tc-42",
            args: nil
        ))
        XCTAssertEqual(vm.messages[0].meta?.toolName, "bash")
        XCTAssertEqual(vm.messages[0].meta?.toolCallId, "tc-42")
    }

    func testToolCallFinalizesOpenStreamingMessage() {
        let vm = makeVM()
        // An open streaming chunk arrives first
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "thinking...", seq: nil))
        XCTAssertTrue(vm.isStreaming)

        vm.handle(event: .toolCall(
            slot: "chat-1-100",
            tool: "bash",
            id: "tc-99",
            args: nil
        ))
        // After toolCall the streaming is finalized
        XCTAssertFalse(vm.isStreaming)
        // Two messages: the finalized text chunk + the tool message
        XCTAssertEqual(vm.messages.count, 2)
        XCTAssertFalse(vm.messages[0].isStreaming)
        XCTAssertEqual(vm.messages[1].role, .tool)
    }

    func testToolCallForWrongSlotIsIgnored() {
        let vm = makeVM(slotKey: "chat-1-100")
        vm.handle(event: .toolCall(
            slot: "chat-99-999",
            tool: "bash",
            id: "tc-x",
            args: nil
        ))
        XCTAssertTrue(vm.messages.isEmpty)
    }

    // MARK: - handle(event:) — toolResult

    func testToolResultPatchesMatchingToolCall() {
        let vm = makeVM()
        vm.handle(event: .toolCall(slot: "chat-1-100", tool: "bash", id: "tc-1", args: nil))
        XCTAssertNil(vm.messages[0].meta?.toolResult)

        vm.handle(event: .toolResult(
            slot: "chat-1-100",
            tool: "bash",
            id: "tc-1",
            result: "exit 0",
            isError: false
        ))
        XCTAssertEqual(vm.messages[0].meta?.toolResult, "exit 0")
        XCTAssertEqual(vm.messages[0].meta?.isError, false)
    }

    func testToolResultSetsIsErrorFlag() {
        let vm = makeVM()
        vm.handle(event: .toolCall(slot: "chat-1-100", tool: "bash", id: "tc-err", args: nil))
        vm.handle(event: .toolResult(
            slot: "chat-1-100",
            tool: "bash",
            id: "tc-err",
            result: "command not found",
            isError: true
        ))
        XCTAssertEqual(vm.messages[0].meta?.isError, true)
        XCTAssertEqual(vm.messages[0].meta?.toolResult, "command not found")
    }

    func testToolResultForWrongIdDoesNotPatch() {
        let vm = makeVM()
        vm.handle(event: .toolCall(slot: "chat-1-100", tool: "bash", id: "tc-1", args: nil))
        vm.handle(event: .toolResult(
            slot: "chat-1-100",
            tool: "bash",
            id: "tc-WRONG",
            result: "should not appear",
            isError: false
        ))
        // The toolCall message should still have nil toolResult
        XCTAssertNil(vm.messages[0].meta?.toolResult)
    }

    func testToolResultForWrongSlotIsIgnored() {
        let vm = makeVM(slotKey: "chat-1-100")
        vm.handle(event: .toolCall(slot: "chat-1-100", tool: "bash", id: "tc-1", args: nil))
        vm.handle(event: .toolResult(
            slot: "chat-99-999",
            tool: "bash",
            id: "tc-1",
            result: "from other slot",
            isError: false
        ))
        XCTAssertNil(vm.messages[0].meta?.toolResult)
    }

    // MARK: - handle(event:) — slotTitle

    func testSlotTitleUpdatesSlotsTitle() {
        let vm = makeVM(slotKey: "chat-1-100")
        XCTAssertEqual(vm.slot.title, "Test Slot")

        vm.handle(event: .slotTitle(key: "chat-1-100", title: "New Title"))
        XCTAssertEqual(vm.slot.title, "New Title")
    }

    func testSlotTitleForWrongKeyIsIgnored() {
        let vm = makeVM(slotKey: "chat-1-100")
        vm.handle(event: .slotTitle(key: "chat-99-999", title: "Should Not Apply"))
        XCTAssertEqual(vm.slot.title, "Test Slot")
    }

    // MARK: - Full streaming cycle

    func testFullStreamingCycleChunkDoneMessage() {
        let vm = makeVM()

        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "Hi", seq: nil))
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: " there", seq: nil))
        XCTAssertTrue(vm.isStreaming)
        XCTAssertEqual(vm.messages[0].content, "Hi there")

        vm.handle(event: .chatDone(slot: "chat-1-100"))
        XCTAssertFalse(vm.isStreaming)
        XCTAssertFalse(vm.messages[0].isStreaming)

        // Second cycle — streaming state resets cleanly
        vm.handle(event: .chatChunk(slot: "chat-1-100", content: "Second", seq: nil))
        XCTAssertTrue(vm.isStreaming)
        XCTAssertEqual(vm.messages.count, 2)
        XCTAssertEqual(vm.messages[1].content, "Second")
    }
}
