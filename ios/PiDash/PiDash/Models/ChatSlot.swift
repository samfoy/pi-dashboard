import Foundation

// MARK: - ChatSlot

/// Represents an active chat session (slot) on the server.
struct ChatSlot: Identifiable, Codable, Equatable {
    let key: String
    var title: String
    var createdAt: Date
    var updatedAt: Date
    var messageCount: Int
    var lastMessage: String?
    var isStreaming: Bool
    var model: String?
    var contextPercent: Double?

    var id: String { key }

    init(
        key: String,
        title: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        messageCount: Int = 0,
        lastMessage: String? = nil,
        isStreaming: Bool = false,
        model: String? = nil,
        contextPercent: Double? = nil
    ) {
        self.key = key
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.messageCount = messageCount
        self.lastMessage = lastMessage
        self.isStreaming = isStreaming
        self.model = model
        self.contextPercent = contextPercent
    }
}

// MARK: - TemporalGroup

/// Groups slots for the list view display.
enum TemporalGroup: String, CaseIterable {
    case today = "Today"
    case yesterday = "Yesterday"
    case lastSevenDays = "Last 7 Days"
    case older = "Older"

    static func group(for date: Date) -> TemporalGroup {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return .today }
        if calendar.isDateInYesterday(date) { return .yesterday }
        if let daysAgo = calendar.dateComponents([.day], from: date, to: Date()).day, daysAgo <= 7 {
            return .lastSevenDays
        }
        return .older
    }
}
