import Foundation

// MARK: - WebSocket Event Envelopes

/// Top-level WS message envelope — all server messages have a `type` field.
struct WSEnvelope: Decodable {
    let type: String
}

// MARK: - REST Response Models

struct SlotsResponse: Decodable {
    let slots: [SlotDTO]
}

struct SlotDetailResponse: Decodable {
    let slot: SlotDTO
    let messages: [MessageDTO]
}

// MARK: - Data Transfer Objects

struct SlotDTO: Decodable {
    let key: String
    let title: String?
    let createdAt: String?
    let updatedAt: String?
    let messageCount: Int?
    let lastMessage: String?
    let model: String?

    func toChatSlot() -> ChatSlot {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let created = createdAt.flatMap { iso.date(from: $0) } ?? Date()
        let updated = updatedAt.flatMap { iso.date(from: $0) } ?? created
        return ChatSlot(
            key: key,
            title: title ?? "New Chat",
            createdAt: created,
            updatedAt: updated,
            messageCount: messageCount ?? 0,
            lastMessage: lastMessage,
            model: model
        )
    }
}

struct MessageDTO: Decodable {
    let role: String
    let content: String
    let ts: Double?
    let meta: MessageMetaDTO?

    func toChatMessage(slotKey: String) -> ChatMessage {
        let date = ts.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
        return ChatMessage(
            slotKey: slotKey,
            role: MessageRole(rawValue: role) ?? .assistant,
            content: content,
            timestamp: date,
            meta: meta.map {
                MessageMeta(
                    thinking: $0.thinking,
                    model: $0.model,
                    inputTokens: $0.inputTokens,
                    outputTokens: $0.outputTokens
                )
            }
        )
    }
}

struct MessageMetaDTO: Decodable {
    let thinking: String?
    let model: String?
    let inputTokens: Int?
    let outputTokens: Int?
}

// MARK: - WebSocket Event Payloads

struct WSSlotsEvent: Decodable {
    let type: String
    let slots: [SlotDTO]
}

struct WSChatChunkEvent: Decodable {
    let type: String
    let slot: String
    let content: String
    let seq: Int?
}

struct WSChatDoneEvent: Decodable {
    let type: String
    let slot: String
}

struct WSChatMessageEvent: Decodable {
    let type: String
    let slot: String
    let role: String
    let content: String
    let ts: Double?
    let meta: MessageMetaDTO?
}

struct WSToolCallEvent: Decodable {
    let type: String
    let slot: String
    let tool: String
    let id: String
    let args: AnyCodable?
}

struct WSToolResultEvent: Decodable {
    let type: String
    let slot: String
    let tool: String
    let id: String
    let result: AnyCodable?
    let isError: Bool?
}

struct WSSlotTitleEvent: Decodable {
    let type: String
    let key: String
    let title: String
}

struct WSContextUsageEvent: Decodable {
    let type: String
    let slot: String
    let tokens: Int?
    let contextWindow: Int?
    let percent: Double?
}

// MARK: - Send Message Request

struct SendMessageRequest: Encodable {
    let slot: String
    let message: String
}

struct CreateSlotRequest: Encodable {
    let title: String?
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
}
