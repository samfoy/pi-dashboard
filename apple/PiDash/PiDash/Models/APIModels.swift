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

    enum CodingKeys: String, CodingKey {
        case messages, running, stopping, total, model, cwd
        case pendingApproval = "pending_approval"
        case hasMore = "has_more"
        // API sends camelCase for this one
        case contextUsage
    }
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
    let createdAt: String?   // ISO8601 from server
    let updatedAt: String?   // ISO8601 from server

    let tags: [String]?

    enum CodingKeys: String, CodingKey {
        case key, title, messages, running, stopping, model, cwd, tags
        case pendingApproval = "pending_approval"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    func toChatSlot() -> ChatSlot {
        let created = createdAt.flatMap { isoDate(from: $0) } ?? dateFromKey(key)
        let updated = updatedAt.flatMap { isoDate(from: $0) } ?? created
        return ChatSlot(
            key: key,
            title: title ?? "New Chat",
            createdAt: created,
            updatedAt: updated,
            messageCount: messages ?? 0,
            lastMessage: nil,
            isStreaming: running ?? false,
            model: model,
            cwd: cwd,
            tags: tags ?? []
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

    enum CodingKeys: String, CodingKey {
        case thinking, model, args, result
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        // API sends camelCase for these
        case toolName, toolCallId, isError
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        thinking = try c.decodeIfPresent(String.self, forKey: .thinking)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        args = try c.decodeIfPresent(String.self, forKey: .args)
        result = try c.decodeIfPresent(String.self, forKey: .result)
        inputTokens = try c.decodeIfPresent(Int.self, forKey: .inputTokens)
        outputTokens = try c.decodeIfPresent(Int.self, forKey: .outputTokens)
        toolName = try c.decodeIfPresent(String.self, forKey: .toolName)
        toolCallId = try c.decodeIfPresent(String.self, forKey: .toolCallId)
        isError = try c.decodeIfPresent(Bool.self, forKey: .isError)
    }
}

// MARK: - WebSocket Notification Event

struct WSNotificationData: Decodable {
    let kind: String
    let title: String
    let body: String?
    let slot: String?
    let ts: String?
    let acked: Bool?
}

struct WSNotificationEvent: Decodable {
    let type: String
    let data: WSNotificationData
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

struct WSSlotTagsData: Decodable {
    let key: String
    let tags: [String]
}

struct WSSlotTagsEvent: Decodable {
    let type: String
    let data: WSSlotTagsData
}

struct WSContextUsageEvent: Decodable {
    let type: String
    let data: WSContextUsageData
}

struct WSChatErrorData: Decodable {
    let slot: String
    let message: String
}

struct WSChatErrorEvent: Decodable {
    let type: String
    let data: WSChatErrorData
}

// MARK: - Send Message Request

struct SendMessageRequest: Encodable {
    let slot: String
    let message: String
    let images: [ImagePayload]?
}

struct ImagePayload: Encodable {
    let data: String  // base64
    let mimeType: String
}

struct CreateSlotRequest: Encodable {
    let name: String?   // API uses "name" not "title"
    let cwd: String?

    init(title: String? = nil, cwd: String? = nil) {
        self.name = title
        self.cwd = cwd
    }
}

struct RenameSlotRequest: Encodable {
    let title: String
}

struct SetModelRequest: Encodable {
    let provider: String
    let modelId: String
}

struct SetThinkingRequest: Encodable {
    let level: String
}

struct SetTagsRequest: Encodable {
    let tags: [String]
}

// MARK: - Notifications

struct NotificationDTO: Decodable, Identifiable {
    let kind: String
    let title: String
    let body: String?
    let slot: String?
    let ts: String
    let acked: Bool

    var id: String { ts }
}

struct NotificationsResponse: Decodable {
    let notifications: [NotificationDTO]
}

// MARK: - Sessions

struct SessionDTO: Decodable, Identifiable {
    let key: String
    let title: String
    let project: String?
    let created: String?
    let modified: String?

    var id: String { key }

    var modifiedDate: Date? {
        guard let m = modified else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: m) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: m)
    }
}

struct SessionsResponse: Decodable {
    let sessions: [SessionDTO]
    let hasMore: Bool?

    enum CodingKeys: String, CodingKey {
        case sessions
        case hasMore = "has_more"
    }
}

// MARK: - Session Search

struct SessionSearchResult: Decodable, Identifiable {
    let resultId: String  // renamed from `id` to avoid Identifiable conflict
    let name: String
    let file: String
    let cwd: String?
    let startedAt: String?
    let projectSlug: String?
    let summary: String?
    let userMessageCount: Int?
    let assistantMessageCount: Int?
    let models: [String]?

    var id: String { resultId }

    enum CodingKeys: String, CodingKey {
        case resultId = "id"
        case name, file, cwd, startedAt, projectSlug, summary
        case userMessageCount, assistantMessageCount, models
    }

    var startedDate: Date? {
        guard let s = startedAt else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    var messageCount: Int {
        (userMessageCount ?? 0) + (assistantMessageCount ?? 0)
    }
}

struct SessionSearchResponse: Decodable {
    let results: [SessionSearchResult]
    let error: String?
}

struct ResumeResponse: Decodable {
    let ok: Bool
    let key: String
}

// MARK: - Browse

/// One directory entry returned by `GET /api/browse`.
struct BrowseEntry: Decodable, Identifiable {
    let name: String
    let path: String
    let isDir: Bool

    var id: String { path }
}

/// Response from `GET /api/browse?path=...`
struct BrowseResponse: Decodable {
    let path: String
    let parent: String?
    let entries: [BrowseEntry]
}

/// Body for `POST /api/chat/slots/:key/cwd`
struct SetCwdRequest: Encodable {
    let cwd: String
}

struct AckNotificationRequest: Encodable {
    let ts: String
}

struct ResumeSessionRequest: Encodable {
    let key: String
    let file: String?

    init(key: String, file: String? = nil) {
        self.key = key
        self.file = file
    }
}

struct ModelsResponse: Decodable {
    let models: [ModelInfo]
}

struct ModelInfo: Decodable, Identifiable, Hashable {
    let provider: String
    let id: String
    let name: String?
    let reasoning: Bool?
    let contextWindow: Int?

    var label: String { name ?? id }

    // For setModel API call, extract just the model ID portion
    var modelId: String { id }
}

// MARK: - File I/O

struct FileVersion: Decodable, Identifiable {
    let version: Int
    let timestamp: String
    let size: Int

    var id: Int { version }

    var formattedDate: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: timestamp) {
            let display = DateFormatter()
            display.dateStyle = .short
            display.timeStyle = .short
            return display.string(from: date)
        }
        return timestamp
    }
}

struct FileVersionsResponse: Decodable {
    let versions: [FileVersion]
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
