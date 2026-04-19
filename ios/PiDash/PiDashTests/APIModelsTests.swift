import XCTest
@testable import PiDash

final class APIModelsTests: XCTestCase {

    // MARK: - SlotDTO

    func testSlotDTODecoding() throws {
        let json = """
        {
            "key": "chat-1-1713400000000",
            "title": "Test Chat",
            "messages": 5,
            "running": true,
            "stopping": false,
            "pending_approval": true,
            "model": "claude-sonnet-4-20250514",
            "cwd": "/Users/test",
            "created_at": "2026-04-18T10:00:00.000Z",
            "updated_at": "2026-04-18T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let slot = try JSONDecoder().decode(SlotDTO.self, from: json)
        XCTAssertEqual(slot.key, "chat-1-1713400000000")
        XCTAssertEqual(slot.title, "Test Chat")
        XCTAssertEqual(slot.messages, 5)
        XCTAssertEqual(slot.running, true)
        XCTAssertEqual(slot.stopping, false)
        XCTAssertEqual(slot.pendingApproval, true)
        XCTAssertEqual(slot.model, "claude-sonnet-4-20250514")
        XCTAssertEqual(slot.cwd, "/Users/test")
    }

    func testSlotDTOMinimalDecoding() throws {
        let json = """
        { "key": "chat-2-1713400000000" }
        """.data(using: .utf8)!

        let slot = try JSONDecoder().decode(SlotDTO.self, from: json)
        XCTAssertEqual(slot.key, "chat-2-1713400000000")
        XCTAssertNil(slot.title)
        XCTAssertNil(slot.messages)
        XCTAssertNil(slot.running)
        XCTAssertNil(slot.model)
    }

    func testSlotDTOToChatSlot() throws {
        let json = """
        {
            "key": "chat-1-1713400000000",
            "title": "My Chat",
            "messages": 3,
            "running": true,
            "model": "gpt-4",
            "created_at": "2026-04-18T10:00:00Z",
            "updated_at": "2026-04-18T12:00:00Z"
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(SlotDTO.self, from: json)
        let chatSlot = dto.toChatSlot()
        XCTAssertEqual(chatSlot.key, "chat-1-1713400000000")
        XCTAssertEqual(chatSlot.title, "My Chat")
        XCTAssertEqual(chatSlot.messageCount, 3)
        XCTAssertTrue(chatSlot.isStreaming)
        XCTAssertEqual(chatSlot.model, "gpt-4")
    }

    func testSlotDTOToChatSlotDefaultTitle() throws {
        let json = """
        { "key": "chat-1-1713400000000" }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(SlotDTO.self, from: json)
        let chatSlot = dto.toChatSlot()
        XCTAssertEqual(chatSlot.title, "New Chat")
        XCTAssertEqual(chatSlot.messageCount, 0)
        XCTAssertFalse(chatSlot.isStreaming)
    }

    func testSlotDTODateFromKey() throws {
        // When no created_at, should parse unix ms from key
        let json = """
        { "key": "chat-1-1713400000000" }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(SlotDTO.self, from: json)
        let chatSlot = dto.toChatSlot()
        // 1713400000000 ms = 1713400000 seconds
        let expected = Date(timeIntervalSince1970: 1713400000.0)
        XCTAssertEqual(chatSlot.createdAt.timeIntervalSince1970, expected.timeIntervalSince1970, accuracy: 1.0)
    }

    // MARK: - SlotDetailResponse

    func testSlotDetailResponseDecoding() throws {
        let json = """
        {
            "messages": [],
            "running": true,
            "stopping": false,
            "pending_approval": false,
            "has_more": true,
            "total": 42,
            "model": "claude-sonnet",
            "cwd": "/tmp",
            "contextUsage": {
                "tokens": 1000,
                "contextWindow": 200000,
                "percent": 0.5
            }
        }
        """.data(using: .utf8)!

        let resp = try JSONDecoder().decode(SlotDetailResponse.self, from: json)
        XCTAssertTrue(resp.messages.isEmpty)
        XCTAssertEqual(resp.running, true)
        XCTAssertEqual(resp.stopping, false)
        XCTAssertEqual(resp.pendingApproval, false)
        XCTAssertEqual(resp.hasMore, true)
        XCTAssertEqual(resp.total, 42)
        XCTAssertEqual(resp.model, "claude-sonnet")
        XCTAssertEqual(resp.contextUsage?.tokens, 1000)
        XCTAssertEqual(resp.contextUsage?.contextWindow, 200000)
        XCTAssertEqual(resp.contextUsage?.percent, 0.5)
    }

    // MARK: - MessageDTO

    func testMessageDTODecoding() throws {
        let json = """
        {
            "role": "assistant",
            "content": "Hello!",
            "ts": "2026-04-18T10:30:00.000Z",
            "meta": {
                "model": "claude-sonnet",
                "input_tokens": 100,
                "output_tokens": 50
            }
        }
        """.data(using: .utf8)!

        let msg = try JSONDecoder().decode(MessageDTO.self, from: json)
        XCTAssertEqual(msg.role, "assistant")
        XCTAssertEqual(msg.content, "Hello!")
        XCTAssertNotNil(msg.ts)
        XCTAssertEqual(msg.meta?.model, "claude-sonnet")
        XCTAssertEqual(msg.meta?.inputTokens, 100)
        XCTAssertEqual(msg.meta?.outputTokens, 50)
    }

    func testMessageDTOToChatMessage() throws {
        let json = """
        {
            "role": "user",
            "content": "Hi there",
            "ts": "2026-04-18T10:30:00Z"
        }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(MessageDTO.self, from: json)
        let msg = dto.toChatMessage(slotKey: "chat-1-123")
        XCTAssertEqual(msg.slotKey, "chat-1-123")
        XCTAssertEqual(msg.role, .user)
        XCTAssertEqual(msg.content, "Hi there")
    }

    func testMessageDTOToolMetaDecoding() throws {
        let json = """
        {
            "role": "tool",
            "content": "result data",
            "meta": {
                "toolName": "bash",
                "toolCallId": "call_123",
                "args": "{\\"command\\": \\"ls\\"}",
                "result": "file1.txt",
                "isError": false
            }
        }
        """.data(using: .utf8)!

        let msg = try JSONDecoder().decode(MessageDTO.self, from: json)
        XCTAssertEqual(msg.meta?.toolName, "bash")
        XCTAssertEqual(msg.meta?.toolCallId, "call_123")
        XCTAssertEqual(msg.meta?.isError, false)
    }

    func testMessageDTOUnknownRoleFallback() throws {
        let json = """
        { "role": "unknown_role", "content": "test" }
        """.data(using: .utf8)!

        let dto = try JSONDecoder().decode(MessageDTO.self, from: json)
        let msg = dto.toChatMessage(slotKey: "s1")
        // Unknown role falls back to .assistant
        XCTAssertEqual(msg.role, .assistant)
    }

    // MARK: - WS Events

    func testWSEnvelopeDecoding() throws {
        let json = """
        { "type": "chat_chunk" }
        """.data(using: .utf8)!

        let envelope = try JSONDecoder().decode(WSEnvelope.self, from: json)
        XCTAssertEqual(envelope.type, "chat_chunk")
    }

    func testWSChatChunkEventDecoding() throws {
        let json = """
        {
            "type": "chat_chunk",
            "data": {
                "slot": "chat-1-123",
                "content": "Hello ",
                "seq": 1
            }
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(WSChatChunkEvent.self, from: json)
        XCTAssertEqual(event.data.slot, "chat-1-123")
        XCTAssertEqual(event.data.content, "Hello ")
        XCTAssertEqual(event.data.seq, 1)
    }

    func testWSSlotsEventDecoding() throws {
        let json = """
        {
            "type": "slots",
            "data": [
                { "key": "chat-1-100", "title": "First" },
                { "key": "chat-2-200", "title": "Second", "running": true }
            ]
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(WSSlotsEvent.self, from: json)
        XCTAssertEqual(event.data.count, 2)
        XCTAssertEqual(event.data[0].key, "chat-1-100")
        XCTAssertEqual(event.data[1].running, true)
    }

    func testWSSlotTitleEventDecoding() throws {
        let json = """
        {
            "type": "slot_title",
            "data": { "key": "chat-1-123", "title": "New Title" }
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(WSSlotTitleEvent.self, from: json)
        XCTAssertEqual(event.data.key, "chat-1-123")
        XCTAssertEqual(event.data.title, "New Title")
    }

    func testWSContextUsageEventDecoding() throws {
        let json = """
        {
            "type": "context_usage",
            "data": { "slot": "chat-1-123", "tokens": 5000, "contextWindow": 200000, "percent": 2.5 }
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(WSContextUsageEvent.self, from: json)
        XCTAssertEqual(event.data.tokens, 5000)
        XCTAssertEqual(event.data.percent, 2.5)
    }

    // MARK: - Encodable Requests

    func testSendMessageRequestEncoding() throws {
        let req = SendMessageRequest(slot: "chat-1-123", message: "Hello", images: nil)
        let data = try JSONEncoder().encode(req)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["slot"] as? String, "chat-1-123")
        XCTAssertEqual(dict["message"] as? String, "Hello")
    }

    func testCreateSlotRequestEncoding() throws {
        let req = CreateSlotRequest(title: "My Slot", cwd: "/tmp")
        let data = try JSONEncoder().encode(req)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        // API uses "name" not "title"
        XCTAssertEqual(dict["name"] as? String, "My Slot")
        XCTAssertEqual(dict["cwd"] as? String, "/tmp")
    }

    func testImagePayloadEncoding() throws {
        let payload = ImagePayload(data: "base64data==", mimeType: "image/jpeg")
        let data = try JSONEncoder().encode(payload)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["data"] as? String, "base64data==")
        XCTAssertEqual(dict["mimeType"] as? String, "image/jpeg")
    }

    // MARK: - SessionDTO

    func testSessionDTODecoding() throws {
        let json = """
        {
            "key": "session-abc",
            "title": "Debug Session",
            "project": "pi-dashboard",
            "created": "2026-04-18T08:00:00.000Z",
            "modified": "2026-04-18T09:00:00.000Z"
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(SessionDTO.self, from: json)
        XCTAssertEqual(session.key, "session-abc")
        XCTAssertEqual(session.title, "Debug Session")
        XCTAssertEqual(session.project, "pi-dashboard")
        XCTAssertNotNil(session.modifiedDate)
    }

    func testSessionsResponseDecoding() throws {
        let json = """
        {
            "sessions": [
                { "key": "s1", "title": "First" }
            ],
            "has_more": true
        }
        """.data(using: .utf8)!

        let resp = try JSONDecoder().decode(SessionsResponse.self, from: json)
        XCTAssertEqual(resp.sessions.count, 1)
        XCTAssertEqual(resp.hasMore, true)
    }

    // MARK: - NotificationDTO

    func testNotificationDTODecoding() throws {
        let json = """
        {
            "kind": "approval",
            "title": "Tool approval needed",
            "body": "bash wants to run",
            "slot": "chat-1-123",
            "ts": "2026-04-18T10:00:00Z",
            "acked": false
        }
        """.data(using: .utf8)!

        let notif = try JSONDecoder().decode(NotificationDTO.self, from: json)
        XCTAssertEqual(notif.kind, "approval")
        XCTAssertEqual(notif.id, "2026-04-18T10:00:00Z")
        XCTAssertFalse(notif.acked)
    }

    // MARK: - BrowseEntry / BrowseResponse

    func testBrowseResponseDecoding() throws {
        let json = """
        {
            "path": "/Users/test",
            "parent": "/Users",
            "entries": [
                { "name": "Documents", "path": "/Users/test/Documents", "isDir": true },
                { "name": "file.txt", "path": "/Users/test/file.txt", "isDir": false }
            ]
        }
        """.data(using: .utf8)!

        let resp = try JSONDecoder().decode(BrowseResponse.self, from: json)
        XCTAssertEqual(resp.path, "/Users/test")
        XCTAssertEqual(resp.parent, "/Users")
        XCTAssertEqual(resp.entries.count, 2)
        XCTAssertTrue(resp.entries[0].isDir)
        XCTAssertFalse(resp.entries[1].isDir)
    }

    // MARK: - ModelInfo

    func testModelInfoDecoding() throws {
        let json = """
        {
            "provider": "anthropic",
            "id": "claude-sonnet-4-20250514",
            "name": "Claude Sonnet 4",
            "reasoning": true,
            "contextWindow": 200000
        }
        """.data(using: .utf8)!

        let model = try JSONDecoder().decode(ModelInfo.self, from: json)
        XCTAssertEqual(model.provider, "anthropic")
        XCTAssertEqual(model.label, "Claude Sonnet 4")
        XCTAssertEqual(model.modelId, "claude-sonnet-4-20250514")
        XCTAssertEqual(model.reasoning, true)
    }

    func testModelInfoLabelFallback() throws {
        let json = """
        { "provider": "openai", "id": "gpt-4" }
        """.data(using: .utf8)!

        let model = try JSONDecoder().decode(ModelInfo.self, from: json)
        // When name is nil, label should be the id
        XCTAssertEqual(model.label, "gpt-4")
    }

    // MARK: - AnyCodable

    func testAnyCodableDecodesString() throws {
        let json = "\"hello\"".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodable.self, from: json)
        XCTAssertEqual(val.value as? String, "hello")
    }

    func testAnyCodableDecodesInt() throws {
        let json = "42".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodable.self, from: json)
        XCTAssertEqual(val.value as? Int, 42)
    }

    func testAnyCodableDecodesBool() throws {
        let json = "true".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodable.self, from: json)
        XCTAssertEqual(val.value as? Bool, true)
    }

    func testAnyCodableJsonString() throws {
        let json = "\"test string\"".data(using: .utf8)!
        let val = try JSONDecoder().decode(AnyCodable.self, from: json)
        XCTAssertEqual(val.jsonString, "test string")
    }

    // MARK: - FileVersion

    func testFileVersionDecoding() throws {
        let json = """
        { "version": 3, "timestamp": "2026-04-18T10:00:00.000Z", "size": 1024 }
        """.data(using: .utf8)!

        let ver = try JSONDecoder().decode(FileVersion.self, from: json)
        XCTAssertEqual(ver.version, 3)
        XCTAssertEqual(ver.size, 1024)
        XCTAssertEqual(ver.id, 3)
        // formattedDate should parse the ISO date
        XCTAssertFalse(ver.formattedDate.isEmpty)
    }
}
