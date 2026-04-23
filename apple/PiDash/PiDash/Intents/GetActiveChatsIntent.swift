import AppIntents

// MARK: - GetActiveChatsIntent

/// Fetches the current list of Pi chat slots and returns them as a
/// numbered string list. Useful in Shortcuts to branch on active chats.
///
/// Siri phrase examples (configured in PiDashShortcuts):
///   • "Get my Pi chats"
///   • "List Pi chats"
struct GetActiveChatsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Active Chats"
    static var description = IntentDescription(
        "Returns a list of your current Pi chat sessions."
    )

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let slots = try await IntentNetworking.fetchSlots()
        if slots.isEmpty {
            return .result(value: "No active chats.")
        }
        let list = slots
            .enumerated()
            .map { (index, slot) in "\(index + 1). \(slot.title)" }
            .joined(separator: "\n")
        return .result(value: list)
    }
}
