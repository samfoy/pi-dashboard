import EventKit
import Foundation

// MARK: - CalendarService

final class CalendarService {
    static let shared = CalendarService()
    private let store = EKEventStore()

    private init() {}

    // MARK: - Authorization

    func requestAuthorization() async throws {
        try await store.requestFullAccessToEvents()
    }

    // MARK: - Fetch upcoming events (today + tomorrow)

    func fetchUpcomingEvents() async -> String {
        let calendars = store.calendars(for: .event)

        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: Date())
        guard let tomorrowEnd = calendar.date(byAdding: .day, value: 2, to: todayStart) else {
            return "No calendar events found."
        }

        let predicate = store.predicateForEvents(
            withStart: todayStart,
            end: tomorrowEnd,
            calendars: calendars.isEmpty ? nil : calendars
        )

        let events = store.events(matching: predicate)
            .sorted { $0.startDate < $1.startDate }

        if events.isEmpty {
            return "Here are my upcoming calendar events: No events scheduled for today or tomorrow."
        }

        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.dateStyle = .none
        formatter.timeStyle = .short

        let dayFormatter = DateFormatter()
        dayFormatter.locale = Locale.current
        dayFormatter.dateFormat = "EEEE, MMM d"

        var lines: [String] = ["Here are my upcoming calendar events:"]

        var currentDay: String? = nil
        for event in events {
            let dayLabel = dayFormatter.string(from: event.startDate)
            if dayLabel != currentDay {
                currentDay = dayLabel
                lines.append("\n\(dayLabel):")
            }

            let timeStr: String
            if event.isAllDay {
                timeStr = "All day"
            } else {
                let start = formatter.string(from: event.startDate)
                let end = formatter.string(from: event.endDate)
                timeStr = "\(start) – \(end)"
            }

            var line = "  • \(timeStr): \(event.title ?? "(untitled)")"
            if let location = event.location, !location.isEmpty {
                line += " @ \(location)"
            }
            lines.append(line)
        }

        return lines.joined(separator: "\n")
    }
}
