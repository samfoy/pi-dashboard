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
    var inputNeeded: Bool
    var cwd: String?

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
        contextPercent: Double? = nil,
        inputNeeded: Bool = false,
        cwd: String? = nil
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
        self.inputNeeded = inputNeeded
        self.cwd = cwd
    }
}

// MARK: - TemporalGroup

/// Groups slots for the list view display.
enum TemporalGroup: Equatable, Hashable {
    case today
    case yesterday
    case lastSevenDays
    case lastThirtyDays
    case month(String)   // e.g. "March 2026"

    var label: String {
        switch self {
        case .today:          return "Today"
        case .yesterday:      return "Yesterday"
        case .lastSevenDays:  return "Last 7 Days"
        case .lastThirtyDays: return "Last 30 Days"
        case .month(let s):   return s
        }
    }

    static func group(for date: Date) -> TemporalGroup {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return .today }
        if calendar.isDateInYesterday(date) { return .yesterday }
        let daysAgo = calendar.dateComponents([.day], from: date, to: Date()).day ?? 0
        if daysAgo <= 7  { return .lastSevenDays }
        if daysAgo <= 30 { return .lastThirtyDays }
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM yyyy"
        return .month(formatter.string(from: date))
    }
}
