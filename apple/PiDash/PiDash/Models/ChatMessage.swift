import Foundation

// MARK: - ChatMessage

/// A single message in a chat conversation.
struct ChatMessage: Identifiable, Codable, Equatable {
    var id: UUID
    let slotKey: String
    var role: MessageRole
    var content: String
    var isStreaming: Bool
    var timestamp: Date
    var meta: MessageMeta?
    /// Raw image data for inline display (transient — not persisted to server)
    var imageData: [Data]

    init(
        id: UUID = UUID(),
        slotKey: String,
        role: MessageRole,
        content: String,
        isStreaming: Bool = false,
        timestamp: Date = Date(),
        meta: MessageMeta? = nil,
        imageData: [Data] = []
    ) {
        self.id = id
        self.slotKey = slotKey
        self.role = role
        self.content = content
        self.isStreaming = isStreaming
        self.timestamp = timestamp
        self.meta = meta
        self.imageData = imageData
    }

    // Custom Codable — imageData is transient, decode as empty
    enum CodingKeys: String, CodingKey {
        case id, slotKey, role, content, isStreaming, timestamp, meta
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        slotKey = try c.decode(String.self, forKey: .slotKey)
        role = try c.decode(MessageRole.self, forKey: .role)
        content = try c.decode(String.self, forKey: .content)
        isStreaming = try c.decode(Bool.self, forKey: .isStreaming)
        timestamp = try c.decode(Date.self, forKey: .timestamp)
        meta = try c.decodeIfPresent(MessageMeta.self, forKey: .meta)
        imageData = []
    }
}

// MARK: - MessageRole

enum MessageRole: String, Codable, Equatable {
    case user
    case assistant
    case system
    case tool
    case thinking
}

// MARK: - MessageMeta

struct MessageMeta: Codable, Equatable {
    // Assistant metadata
    var thinking: String?
    var model: String?
    var inputTokens: Int?
    var outputTokens: Int?
    // Tool message metadata
    var toolName: String?
    var toolCallId: String?
    var toolArgs: String?      // JSON string of args
    var toolResult: String?
    var isError: Bool?
}
