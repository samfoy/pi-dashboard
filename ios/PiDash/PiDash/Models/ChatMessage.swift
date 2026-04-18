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

    init(
        id: UUID = UUID(),
        slotKey: String,
        role: MessageRole,
        content: String,
        isStreaming: Bool = false,
        timestamp: Date = Date(),
        meta: MessageMeta? = nil
    ) {
        self.id = id
        self.slotKey = slotKey
        self.role = role
        self.content = content
        self.isStreaming = isStreaming
        self.timestamp = timestamp
        self.meta = meta
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
