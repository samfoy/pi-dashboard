import XCTest
@testable import PiDash

final class ChatMessageTests: XCTestCase {

    // MARK: - Initialization

    func testDefaultInitialization() {
        let msg = ChatMessage(slotKey: "chat-1-123", role: .user, content: "Hello")
        XCTAssertEqual(msg.slotKey, "chat-1-123")
        XCTAssertEqual(msg.role, .user)
        XCTAssertEqual(msg.content, "Hello")
        XCTAssertFalse(msg.isStreaming)
        XCTAssertNil(msg.meta)
        XCTAssertTrue(msg.imageData.isEmpty)
    }

    func testStreamingMessage() {
        let msg = ChatMessage(slotKey: "s1", role: .assistant, content: "partial", isStreaming: true)
        XCTAssertTrue(msg.isStreaming)
        XCTAssertEqual(msg.role, .assistant)
    }

    func testMessageWithMeta() {
        let meta = MessageMeta(
            thinking: "Let me think...",
            model: "claude-sonnet",
            inputTokens: 100,
            outputTokens: 50
        )
        let msg = ChatMessage(slotKey: "s1", role: .assistant, content: "Response", meta: meta)
        XCTAssertEqual(msg.meta?.thinking, "Let me think...")
        XCTAssertEqual(msg.meta?.model, "claude-sonnet")
        XCTAssertEqual(msg.meta?.inputTokens, 100)
        XCTAssertEqual(msg.meta?.outputTokens, 50)
    }

    func testToolMessage() {
        let meta = MessageMeta(
            toolName: "bash",
            toolCallId: "call_abc",
            toolArgs: "{\"command\": \"ls\"}",
            toolResult: "file.txt",
            isError: false
        )
        let msg = ChatMessage(slotKey: "s1", role: .tool, content: "tool output", meta: meta)
        XCTAssertEqual(msg.role, .tool)
        XCTAssertEqual(msg.meta?.toolName, "bash")
        XCTAssertEqual(msg.meta?.isError, false)
    }

    // MARK: - Identifiable

    func testUniqueIDs() {
        let msg1 = ChatMessage(slotKey: "s1", role: .user, content: "a")
        let msg2 = ChatMessage(slotKey: "s1", role: .user, content: "a")
        XCTAssertNotEqual(msg1.id, msg2.id)
    }

    // MARK: - Equatable

    func testEquatable() {
        let id = UUID()
        let date = Date()
        let msg1 = ChatMessage(id: id, slotKey: "s1", role: .user, content: "Hi", timestamp: date)
        let msg2 = ChatMessage(id: id, slotKey: "s1", role: .user, content: "Hi", timestamp: date)
        XCTAssertEqual(msg1, msg2)
    }

    func testNotEqual() {
        let msg1 = ChatMessage(slotKey: "s1", role: .user, content: "Hi")
        let msg2 = ChatMessage(slotKey: "s1", role: .user, content: "Bye")
        XCTAssertNotEqual(msg1, msg2)
    }

    // MARK: - Codable Round-Trip

    func testCodableRoundTrip() throws {
        let meta = MessageMeta(model: "test-model", inputTokens: 10, outputTokens: 20)
        let original = ChatMessage(
            slotKey: "chat-1-123",
            role: .assistant,
            content: "Response text",
            isStreaming: false,
            timestamp: Date(timeIntervalSince1970: 1713400000),
            meta: meta,
            imageData: [Data([0xFF, 0xD8])]
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: data)

        XCTAssertEqual(decoded.id, original.id)
        XCTAssertEqual(decoded.slotKey, original.slotKey)
        XCTAssertEqual(decoded.role, original.role)
        XCTAssertEqual(decoded.content, original.content)
        XCTAssertEqual(decoded.meta?.model, "test-model")
        // imageData is transient — should be empty after decoding
        XCTAssertTrue(decoded.imageData.isEmpty)
    }

    // MARK: - MessageRole

    func testMessageRoleRawValues() {
        XCTAssertEqual(MessageRole.user.rawValue, "user")
        XCTAssertEqual(MessageRole.assistant.rawValue, "assistant")
        XCTAssertEqual(MessageRole.system.rawValue, "system")
        XCTAssertEqual(MessageRole.tool.rawValue, "tool")
        XCTAssertEqual(MessageRole.thinking.rawValue, "thinking")
    }

    func testMessageRoleFromRawValue() {
        XCTAssertEqual(MessageRole(rawValue: "user"), .user)
        XCTAssertEqual(MessageRole(rawValue: "tool"), .tool)
        XCTAssertNil(MessageRole(rawValue: "invalid"))
    }

    // MARK: - MessageMeta

    func testMessageMetaCodableRoundTrip() throws {
        let meta = MessageMeta(
            thinking: "hmm",
            model: "claude",
            inputTokens: 5,
            outputTokens: 10,
            toolName: "read",
            toolCallId: "tc1",
            toolArgs: "{}",
            toolResult: "ok",
            isError: false
        )
        let data = try JSONEncoder().encode(meta)
        let decoded = try JSONDecoder().decode(MessageMeta.self, from: data)
        XCTAssertEqual(decoded, meta)
    }
}
