import Foundation

// MARK: - RelativeTimeFormatter

enum RelativeTimeFormatter {
    private static let formatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .none
        f.timeStyle = .short
        return f
    }()

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()

    /// Returns a human-friendly relative time string.
    static func string(from date: Date) -> String {
        let calendar = Calendar.current
        let now = Date()
        let diff = now.timeIntervalSince(date)

        if diff < 60 { return "Just now" }
        if diff < 3600 { return formatter.localizedString(for: date, relativeTo: now) }
        if calendar.isDateInToday(date) { return timeFormatter.string(from: date) }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        if diff < 7 * 86400 { return formatter.localizedString(for: date, relativeTo: now) }
        return dateFormatter.string(from: date)
    }
}
