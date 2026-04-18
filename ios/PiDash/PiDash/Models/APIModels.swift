import Foundation

// MARK: - WebSocket Event Envelopes

/// Top-level WS message envelope — all server messages use `{ "type": "...", "data": {...} }`.
struct WSEnvelope: Decodable {
    let type: String
}

/// Generic data-wrapper for decoding the `data` field of a WS event.
private struct WSDataWrapper<T: Decodable>: Decodable {
    let data: T
}

// MARK: - REST Response Models

/// `/api/chat/slots/:key` — flat object (no `slot` nesting).
struct SlotDetailResponse: Decodable {
    let messages: [MessageDTO]
    let running: Bool?
    let stopping: Bool?
    let pendingApproval: Bool?
    let hasMore: Bool?
    let total: Int?
    let model: String?
    let cwd: String?
    let contextUsage: ContextUsageDTO?
}

struct ContextUsageDTO: Decodable {
    let tokens: Int?
    let contextWindow: Int?
    let percent: Double?
}

// MARK: - Data Transfer Objects

/// Maps the flat `GET /api/chat/slots` array element.
struct SlotDTO: Decodable {
    let key: String
    let title: String?
    let messages: Int?       // message count
    let running: Bool?
    let stopping: Bool?
    let pendingApproval: Bool?
    let model: String?
    let cwd: String?

    func toChatSlot() -> ChatSlot {
        return ChatSlot(
            key: key,
            title: title ?? "New Chat",
            createdAt: dateFromKey(key),
            updatedAt: dateFromKey(key),
            messageCount: messages ?? 0,
            lastMessage: nil,
            isStreaming: running ?? false,
            model: model
        )
    }
}

/// Parse unix-ms timestamp from slot key format `chat-N-<unixMs>`.
private func dateFromKey(_ key: String) -> Date {
    let parts = key.split(separator: "-")
    // key is "chat-1-1713400000000" → last component is unix ms
    if let lastPart = parts.last, let ms = Double(lastPart) {
        return Date(timeIntervalSince1970: ms / 1000.0)
    }
    return Date()
}

struct MessageDTO: Decodable {
    let role: String
    let content: String
    let ts: String?          // ISO8601 string
    let meta: MessageMetaDTO?

    func toChatMessage(slotKey: String) -> ChatMessage {
        let date = ts.flatMap { isoDate(from: $0) } ?? Date()
        let msgRole = MessageRole(rawValue: role) ?? .assistant
        return ChatMessage(
            slotKey: slotKey,
            role: msgRole,
            content: content,
            timestamp: date,
            meta: meta.map {
                MessageMeta(
                    thinking: $0.thinking,
                    model: $0.model,
                    inputTokens: $0.inputTokens,
                    outputTokens: $0.outputTokens,
                    toolName: $0.toolName,
                    toolCallId: $0.toolCallId,
                    toolArgs: $0.args,
                    toolResult: $0.result,
                    isError: $0.isError
                )
            }
        )
    }
}

private func isoDate(from string: String) -> Date? {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = fmt.date(from: string) { return d }
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.date(from: string)
}

struct MessageMetaDTO: Decodable {
    let thinking: String?
    let model: String?
    let inputTokens: Int?
    let outputTokens: Int?
    // Tool message fields
    let toolName: String?
    let toolCallId: String?
    let args: String?         // JSON string
    let result: String?
    let isError: Bool?
}

// MARK: - WebSocket Event Payloads (data-wrapped)

private struct WSSlotsData: Decodable {
    // `data` field is a direct array: `{ "type": "slots", "data": [...] }`
}

struct WSChatChunkData: Decodable {
    let slot: String
    let content: String
    let seq: Int?
}

struct WSChatDoneData: Decodable {
    let slot: String
}

struct WSChatMessageData: Decodable {
    let slot: String
    let role: String
    let content: String
    let ts: String?
    let meta: MessageMetaDTO?
}

struct WSToolCallData: Decodable {
    let slot: String
    let tool: String
    let id: String
    let args: AnyCodable?
}

struct WSToolResultData: Decodable {
    let slot: String
    let tool: String
    let id: String
    let result: AnyCodable?
    let isError: Bool?
}

struct WSSlotTitleData: Decodable {
    let key: String
    let title: String
}

struct WSContextUsageData: Decodable {
    let slot: String
    let tokens: Int?
    let contextWindow: Int?
    let percent: Double?
}

// MARK: - WS top-level typed wrappers

/// `{ "type": "slots", "data": [ SlotDTO... ] }` — data is an array directly.
struct WSSlotsEvent: Decodable {
    let type: String
    let data: [SlotDTO]
}

struct WSChatChunkEvent: Decodable {
    let type: String
    let data: WSChatChunkData
}

struct WSChatDoneEvent: Decodable {
    let type: String
    let data: WSChatDoneData
}

struct WSChatMessageEvent: Decodable {
    let type: String
    let data: WSChatMessageData
}

struct WSToolCallEvent: Decodable {
    let type: String
    let data: WSToolCallData
}

struct WSToolResultEvent: Decodable {
    let type: String
    let data: WSToolResultData
}

struct WSSlotTitleEvent: Decodable {
    let type: String
    let data: WSSlotTitleData
}

struct WSContextUsageEvent: Decodable {
    let type: String
    let data: WSContextUsageData
}

// MARK: - Send Message Request

struct SendMessageRequest: Encodable {
    let slot: String
    let message: String
}

struct CreateSlotRequest: Encodable {
    let name: String?   // API uses "name" not "title"

    init(title: String? = nil) {
        self.name = title
    }
}

// MARK: - AnyCodable helper

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let i = try? container.decode(Int.self) { value = i }
        else if let d = try? container.decode(Double.self) { value = d }
        else if let s = try? container.decode(String.self) { value = s }
        else if let b = try? container.decode(Bool.self) { value = b }
        else if let arr = try? container.decode([AnyCodable].self) { value = arr.map { $0.value } }
        else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let i as Int: try container.encode(i)
        case let d as Double: try container.encode(d)
        case let s as String: try container.encode(s)
        case let b as Bool: try container.encode(b)
        default: try container.encodeNil()
        }
    }

    /// Best-effort JSON string representation of the contained value.
    var jsonString: String? {
        if let s = value as? String { return s }
        if let data = try? JSONSerialization.data(withJSONObject: value),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return "\(value)"
    }
}
