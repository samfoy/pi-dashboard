import EventKit
import Foundation

// MARK: - RemindersService

final class RemindersService {
    static let shared = RemindersService()
    private let store = EKEventStore()
    private init() {}

    // MARK: - Authorization

    func requestAuthorization() async throws {
        try await store.requestFullAccessToReminders()
    }

    // MARK: - Fetch

    /// Returns a formatted context string of incomplete reminders from the default list.
    func fetchIncompleteReminders() async -> String {
        let calendars: [EKCalendar]
        if let defaultCal = store.defaultCalendarForNewReminders() {
            calendars = [defaultCal]
        } else {
            calendars = store.calendars(for: .reminder)
        }

        guard !calendars.isEmpty else {
            return "[Reminders — Incomplete]\n(No reminders calendar found)"
        }

        return await withCheckedContinuation { continuation in
            let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
            store.fetchReminders(matching: predicate) { reminders in
                let items = (reminders ?? []).sorted { lhs, rhs in
                    let lDate = lhs.dueDateComponents?.date
                    let rDate = rhs.dueDateComponents?.date
                    switch (lDate, rDate) {
                    case (nil, nil): return false
                    case (nil, _): return false
                    case (_, nil): return true
                    case (let l?, let r?): return l < r
                    }
                }

                if items.isEmpty {
                    continuation.resume(returning: "[Reminders — Incomplete]\n(No incomplete reminders)")
                    return
                }

                var lines: [String] = ["[Reminders — Incomplete]"]
                for reminder in items {
                    let title = reminder.title ?? "(No title)"
                    if let comps = reminder.dueDateComponents, let date = comps.date {
                        let fmt = DateFormatter()
                        fmt.dateStyle = .short
                        fmt.timeStyle = comps.hour != nil ? .short : .none
                        lines.append("• \(title) (due: \(fmt.string(from: date)))")
                    } else {
                        lines.append("• \(title) (no due date)")
                    }
                }

                continuation.resume(returning: lines.joined(separator: "\n"))
            }
        }
    }
}

// MARK: - DateComponents convenience

private extension DateComponents {
    var date: Date? {
        Calendar.current.date(from: self)
    }
}
